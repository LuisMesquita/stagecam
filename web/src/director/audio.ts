import { SILENCE } from '../engine/scene.ts';
import type { Signals } from '../engine/scene.ts';
import { BeatDetector } from './beat.ts';

export const MUSIC_ON_MAC = 'display';

const BANDS = {
  bass: [30, 150],
  mid: [150, 2000],
  high: [2000, 12000],
  level: [30, 12000],
} as const;

/** Turns an audio input into the 0–1 signals effects can follow. */
export class AudioAnalyzer {
  /** Multiplies band levels; the sensitivity slider. */
  gain = 1.5;
  signals: Signals = { ...SILENCE };
  readonly beats = new BeatDetector();
  onBeat: () => void = () => {};
  onEnded: () => void = () => {};
  #context: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #stream: MediaStream | null = null;
  #bins = new Uint8Array(0);

  get active(): boolean {
    return this.#analyser !== null;
  }

  /** `deviceId` of a microphone, or MUSIC_ON_MAC to capture a tab or the whole screen's audio. */
  async start(deviceId: string): Promise<void> {
    this.stop();
    const stream = deviceId === MUSIC_ON_MAC ? await captureMusic() : await captureMic(deviceId);
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio was shared. Tick "Also share tab audio" (or system audio) and try again.',
      );
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    track.onended = () => {
      this.stop();
      this.onEnded();
    };
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    // Analysis only: never connected to the speakers, so a mic doesn't feed back.
    context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    this.#context = context;
    this.#analyser = analyser;
    this.#stream = stream;
    this.#bins = new Uint8Array(analyser.frequencyBinCount);
  }

  /** Chrome starts an AudioContext suspended until the page gets a user gesture. */
  resume(): void {
    if (this.#context?.state === 'suspended') void this.#context.resume();
  }

  stop(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    void this.#context?.close();
    this.#context = null;
    this.#analyser = null;
    this.#stream = null;
    this.signals = { ...SILENCE };
  }

  update(now: number): Signals {
    const analyser = this.#analyser;
    if (!analyser || !this.#context) return this.signals;
    analyser.getByteFrequencyData(this.#bins);
    const hzPerBin = this.#context.sampleRate / analyser.fftSize;
    const band = ([low, high]: readonly [number, number]) => {
      const from = Math.max(1, Math.floor(low / hzPerBin));
      const to = Math.min(this.#bins.length - 1, Math.ceil(high / hzPerBin));
      let sum = 0;
      for (let i = from; i <= to; i++) sum += this.#bins[i];
      return Math.min(1, (sum / (to - from + 1) / 255) * this.gain);
    };
    const bass = band(BANDS.bass);
    if (this.beats.update(bass, now)) this.onBeat();
    this.signals = {
      bass,
      mid: band(BANDS.mid),
      high: band(BANDS.high),
      level: band(BANDS.level),
      beat: this.beats.pulse(now),
    };
    return this.signals;
  }
}

function captureMic(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

function captureMusic(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome-specific hints: offer system audio, keep the music audible while captured.
    systemAudio: 'include',
    suppressLocalAudioPlayback: false,
  } as DisplayMediaStreamOptions);
}

export async function listMics(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
