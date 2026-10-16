import type { CameraInfo, ClientMsg, ServerMsg } from '../web/src/shared/protocol.ts';
import { DIRECTOR_ID } from '../web/src/shared/protocol.ts';

export interface Peer {
  /** True when the peer connected through the loopback-only director listener. */
  readonly local: boolean;
  send(msg: ServerMsg): void;
  close(code: number, reason: string): void;
}

type Role = { role: 'director' } | { role: 'camera'; id: string };

export const CLOSE_REPLACED = 4000;
export const CLOSE_KICKED = 4001;
export const CLOSE_FORBIDDEN = 4003;

const MAX_NAME = 32;

export class Hub {
  #director: Peer | null = null;
  #cameras = new Map<string, { peer: Peer; info: CameraInfo }>();
  #roles = new Map<Peer, Role>();

  get cameraCount(): number {
    return this.#cameras.size;
  }

  receive(peer: Peer, msg: ClientMsg): void {
    if (msg.t === 'hello') {
      if (msg.role === 'director') this.#helloDirector(peer);
      else this.#helloCamera(peer, msg.camera);
      return;
    }
    const role = this.#roles.get(peer);
    if (!role) return peer.send({ t: 'error', message: 'Send hello first' });
    if (role.role === 'camera') this.#fromCamera(role.id, msg);
    else this.#fromDirector(msg);
  }

  disconnect(peer: Peer): void {
    const role = this.#roles.get(peer);
    this.#roles.delete(peer);
    if (!role) return;
    if (role.role === 'director') {
      if (this.#director !== peer) return;
      this.#director = null;
      for (const { peer: cam } of this.#cameras.values()) cam.send({ t: 'director-gone' });
      return;
    }
    if (this.#cameras.get(role.id)?.peer !== peer) return;
    this.#cameras.delete(role.id);
    this.#director?.send({ t: 'camera-left', id: role.id });
  }

  #helloDirector(peer: Peer): void {
    if (!peer.local) {
      peer.send({ t: 'error', message: 'The director only runs on the host machine' });
      return peer.close(CLOSE_FORBIDDEN, 'forbidden');
    }
    const previous = this.#director;
    if (previous && previous !== peer) {
      this.#roles.delete(previous);
      previous.close(CLOSE_REPLACED, 'replaced');
    }
    this.#director = peer;
    this.#roles.set(peer, { role: 'director' });
    peer.send({ t: 'cameras', list: [...this.#cameras.values()].map((c) => c.info) });
    for (const { peer: cam } of this.#cameras.values()) cam.send({ t: 'director-ready' });
  }

  #helloCamera(peer: Peer, camera: CameraInfo): void {
    const info = sanitize(camera);
    if (!info.id || info.id === DIRECTOR_ID) {
      peer.send({ t: 'error', message: 'Invalid camera id' });
      return peer.close(CLOSE_FORBIDDEN, 'invalid id');
    }
    const previous = this.#cameras.get(info.id);
    if (previous && previous.peer !== peer) {
      this.#roles.delete(previous.peer);
      previous.peer.close(CLOSE_REPLACED, 'replaced');
    }
    this.#cameras.set(info.id, { peer, info });
    this.#roles.set(peer, { role: 'camera', id: info.id });
    this.#director?.send({ t: 'camera-joined', camera: info });
    if (this.#director) peer.send({ t: 'director-ready' });
  }

  #fromCamera(id: string, msg: ClientMsg): void {
    const entry = this.#cameras.get(id);
    if (!entry) return;
    if (msg.t === 'update') {
      entry.info = sanitize({ ...msg.camera, id });
      this.#director?.send({ t: 'camera-updated', camera: entry.info });
    } else if (msg.t === 'signal') {
      this.#director?.send({ t: 'signal', from: id, data: msg.data });
    }
  }

  #fromDirector(msg: ClientMsg): void {
    if (msg.t !== 'signal' && msg.t !== 'tally' && msg.t !== 'kick' && msg.t !== 'rename') return;
    if (!msg.to) return;
    const entry = this.#cameras.get(msg.to);
    if (!entry) return;
    switch (msg.t) {
      case 'signal':
        return entry.peer.send({ t: 'signal', from: DIRECTOR_ID, data: msg.data });
      case 'tally':
        return entry.peer.send({ t: 'tally', state: msg.state });
      case 'rename':
        entry.info = sanitize({ ...entry.info, name: msg.name });
        entry.peer.send({ t: 'renamed', name: entry.info.name });
        return this.#director?.send({ t: 'camera-updated', camera: entry.info });
      case 'kick':
        entry.peer.send({ t: 'kicked' });
        this.#cameras.delete(msg.to);
        this.#roles.delete(entry.peer);
        entry.peer.close(CLOSE_KICKED, 'kicked');
        return this.#director?.send({ t: 'camera-left', id: msg.to });
    }
  }
}

function sanitize(camera: CameraInfo): CameraInfo {
  return {
    id: String(camera.id ?? '').slice(0, 64),
    name:
      String(camera.name ?? '')
        .trim()
        .slice(0, MAX_NAME) || 'Camera',
    facing: camera.facing === 'user' ? 'user' : 'environment',
  };
}
