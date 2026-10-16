import type { Engine } from '../engine/engine.ts';
import type { CameraInfo, ServerMsg, SignalData } from '../shared/protocol.ts';
import type { Signal } from '../shared/signal.ts';

export interface LinkStats {
  fps: number;
  kbps: number;
  height: number;
}

export interface Camera {
  info: CameraInfo;
  stats: LinkStats | null;
  number: number;
  online: boolean;
  link: RTCPeerConnectionState | 'waiting';
  video: HTMLVideoElement;
  pc: RTCPeerConnection | null;
  pending: RTCIceCandidateInit[];
}

const NUMBERS_KEY = 'stagecam.cameraNumbers';
const STATS_INTERVAL_MS = 1000;
/**
 * `?codec=any` on the director URL skips the H.264 preference. Tests use it: Chrome as a *sender*
 * stalls in its hardware H.264 encoder when headless, which never happens with iPhones.
 */
const PREFER_H264 = new URLSearchParams(location.search).get('codec') !== 'any';

/** Receives one WebRTC stream per phone and feeds it to the engine. */
export class CameraManager {
  readonly cameras = new Map<string, Camera>();
  onChange: () => void = () => {};
  #engine: Engine;
  #videoHost: HTMLElement;
  #signal: Signal | null = null;
  #numbers: Record<string, number>;

  constructor(engine: Engine, videoHost: HTMLElement) {
    this.#engine = engine;
    this.#videoHost = videoHost;
    try {
      this.#numbers = JSON.parse(localStorage.getItem(NUMBERS_KEY) ?? '{}') as Record<
        string,
        number
      >;
    } catch {
      this.#numbers = {};
    }
    setInterval(() => void this.#pollStats(), STATS_INTERVAL_MS);
  }

  attach(signal: Signal): void {
    this.#signal = signal;
  }

  sorted(): Camera[] {
    return [...this.cameras.values()].sort((a, b) => a.number - b.number);
  }

  byNumber(number: number): Camera | undefined {
    return this.sorted().find((camera) => camera.number === number);
  }

  label(id: string): string {
    const camera = this.cameras.get(id);
    return camera ? `${camera.number} · ${camera.info.name}` : 'Missing camera';
  }

  handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'cameras':
        for (const camera of this.cameras.values()) this.#goOffline(camera);
        msg.list.forEach((info) => this.#upsert(info));
        break;
      case 'camera-joined':
        this.#upsert(msg.camera);
        break;
      case 'camera-updated':
        this.#upsert(msg.camera);
        break;
      case 'camera-left': {
        const camera = this.cameras.get(msg.id);
        if (camera) this.#goOffline(camera);
        break;
      }
      case 'signal':
        void this.#onSignal(msg.from, msg.data);
        return;
      default:
        return;
    }
    this.onChange();
  }

  directorDisconnected(): void {
    for (const camera of this.cameras.values()) this.#goOffline(camera);
    this.onChange();
  }

  rename(id: string, name: string): void {
    this.#signal?.send({ t: 'rename', to: id, name });
  }

  kick(id: string): void {
    const camera = this.cameras.get(id);
    if (!camera) return;
    this.#signal?.send({ t: 'kick', to: id });
    this.#goOffline(camera);
    camera.video.remove();
    this.cameras.delete(id);
    this.#engine.removeSource(id);
    this.onChange();
  }

  #upsert(info: CameraInfo): void {
    let camera = this.cameras.get(info.id);
    if (!camera) {
      const video = Object.assign(document.createElement('video'), {
        muted: true,
        autoplay: true,
        playsInline: true,
      });
      this.#videoHost.append(video);
      camera = {
        info,
        stats: null,
        number: this.#assignNumber(info.id),
        online: true,
        link: 'waiting',
        video,
        pc: null,
        pending: [],
      };
      this.cameras.set(info.id, camera);
    }
    camera.info = info;
    camera.online = true;
    this.#engine.setMirror(info.id, info.facing === 'user');
  }

  #goOffline(camera: Camera): void {
    camera.online = false;
    camera.stats = null;
    camera.link = 'waiting';
    camera.pc?.close();
    camera.pc = null;
  }

  async #onSignal(from: string, data: SignalData): Promise<void> {
    const camera = this.cameras.get(from);
    if (!camera) return;
    if ('sdp' in data) {
      if (data.sdp.type === 'offer') await this.#answer(camera, data.sdp);
      return;
    }
    if (camera.pc?.remoteDescription)
      await camera.pc.addIceCandidate(data.candidate).catch(() => {});
    else camera.pending.push(data.candidate);
  }

  async #answer(camera: Camera, offer: RTCSessionDescriptionInit): Promise<void> {
    camera.pc?.close();
    camera.pending = [];
    const pc = new RTCPeerConnection({ iceServers: [] });
    camera.pc = pc;
    const id = camera.info.id;
    pc.ontrack = (event) => {
      camera.video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void camera.video.play().catch(() => {});
      this.#engine.setSource(id, camera.video, camera.info.facing === 'user');
    };
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.#signal?.send({ t: 'signal', to: id, data: { candidate: event.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (camera.pc !== pc) return;
      camera.link = pc.connectionState;
      this.onChange();
    };
    await pc.setRemoteDescription(offer);
    if (PREFER_H264) preferH264(pc);
    for (const candidate of camera.pending) await pc.addIceCandidate(candidate).catch(() => {});
    camera.pending = [];
    await pc.setLocalDescription(await pc.createAnswer());
    this.#signal?.send({ t: 'signal', to: id, data: { sdp: pc.localDescription!.toJSON() } });
  }

  #lastBytes = new Map<string, { bytes: number; at: number }>();

  async #pollStats(): Promise<void> {
    for (const camera of this.cameras.values()) {
      const pc = camera.pc;
      if (!pc || pc.connectionState !== 'connected') {
        camera.stats = null;
        continue;
      }
      const report = await pc.getStats();
      report.forEach((entry) => {
        if (entry.type !== 'inbound-rtp' || entry.kind !== 'video') return;
        const id = camera.info.id;
        const now = entry.timestamp as number;
        const bytes = entry.bytesReceived as number;
        const last = this.#lastBytes.get(id);
        this.#lastBytes.set(id, { bytes, at: now });
        // No rate on the first sample of a link (or after a reconnect reset the counter).
        if (!last || now <= last.at || bytes < last.bytes) return;
        const kbps = ((bytes - last.bytes) * 8) / (now - last.at);
        camera.stats = {
          fps: Math.round((entry.framesPerSecond as number | undefined) ?? 0),
          kbps: Math.round(kbps),
          height: (entry.frameHeight as number | undefined) ?? 0,
        };
      });
    }
  }

  #assignNumber(id: string): number {
    const taken = new Set([...this.cameras.values()].map((camera) => camera.number));
    let number = this.#numbers[id];
    if (!number || taken.has(number)) {
      number = 1;
      while (taken.has(number)) number++;
    }
    this.#numbers[id] = number;
    localStorage.setItem(NUMBERS_KEY, JSON.stringify(this.#numbers));
    return number;
  }
}

/** iPhones encode H.264 in hardware; preferring it keeps phones cool and latency low. */
function preferH264(pc: RTCPeerConnection): void {
  const capabilities = RTCRtpReceiver.getCapabilities('video');
  if (!capabilities) return;
  const codecs = [...capabilities.codecs].sort(
    (a, b) => Number(b.mimeType === 'video/H264') - Number(a.mimeType === 'video/H264'),
  );
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.receiver.track.kind === 'video') transceiver.setCodecPreferences(codecs);
  }
}
