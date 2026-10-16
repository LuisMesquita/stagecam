import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { Face } from '../engine/types.ts';
import { landmarksToOutput } from './geometry.ts';
import type { SourceGeometry } from './geometry.ts';

const MODEL_URL = '/models/face_landmarker.task';
const MAX_FACES = 3;
const RUN_EVERY_MS = 33;
const IDLE_DISPOSE_MS = 10_000;
/** How much of each new detection to take; the rest is the previous position (less jitter). */
const SMOOTHING = 0.65;

export interface TrackedSource extends SourceGeometry {
  id: string;
  video: HTMLVideoElement;
}

interface Track {
  landmarker: FaceLandmarker | null;
  lastRun: number;
  lastTimestamp: number;
  lastVideoTime: number;
  usedAt: number;
  faces: Face[];
}

/** One MediaPipe Face Landmarker per camera that needs faces, run on the director's frames. */
export class FaceTracker {
  onError: (error: Error) => void = (error) => console.error(error);
  /** Detections run and faces found so far, for diagnostics. */
  readonly stats = { loaded: 0, runs: 0, faces: 0 };
  #tracks = new Map<string, Track>();
  #width: number;
  #height: number;
  #delegate: 'GPU' | 'CPU' = 'GPU';

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
  }

  faces(id: string): Face[] {
    return this.#tracks.get(id)?.faces ?? [];
  }

  /** Call once per frame with the cameras that need faces; runs at most one detection. */
  update(sources: TrackedSource[], now: number): void {
    for (const source of sources) {
      let track = this.#tracks.get(source.id);
      if (!track) {
        track = {
          landmarker: null,
          lastRun: 0,
          lastTimestamp: 0,
          lastVideoTime: -1,
          usedAt: now,
          faces: [],
        };
        this.#tracks.set(source.id, track);
        void this.#load(track);
      }
      track.usedAt = now;
    }
    const due = sources
      .map((source) => ({ source, track: this.#tracks.get(source.id)! }))
      .filter(
        ({ track, source }) =>
          track.landmarker && now - track.lastRun >= RUN_EVERY_MS && source.video.readyState >= 2,
      )
      .sort((a, b) => a.track.lastRun - b.track.lastRun)[0];
    if (due) this.#detect(due.source, due.track, now);
    for (const [id, track] of this.#tracks) {
      if (now - track.usedAt > IDLE_DISPOSE_MS) {
        track.landmarker?.close();
        this.#tracks.delete(id);
      }
    }
  }

  async #load(track: Track): Promise<void> {
    try {
      track.landmarker = await this.#create(this.#delegate);
      this.stats.loaded++;
    } catch (error) {
      if (this.#delegate === 'CPU')
        return this.onError(new Error(`Face tracking unavailable: ${String(error)}`));
      this.#delegate = 'CPU';
      await this.#load(track);
    }
  }

  #create(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
    return FaceLandmarker.createFromOptions(
      { wasmLoaderPath, wasmBinaryPath },
      {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: MAX_FACES,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      },
    );
  }

  #detect(source: TrackedSource, track: Track, now: number): void {
    track.lastRun = now;
    if (source.video.currentTime === track.lastVideoTime) return;
    track.lastVideoTime = source.video.currentTime;
    // VIDEO mode needs strictly increasing timestamps per landmarker.
    const timestamp = Math.max(Math.round(now), track.lastTimestamp + 1);
    track.lastTimestamp = timestamp;
    let result;
    try {
      result = track.landmarker!.detectForVideo(source.video, timestamp);
    } catch (error) {
      this.onError(new Error(`Face tracking failed: ${String(error)}`));
      return;
    }
    this.stats.runs++;
    this.stats.faces += result.faceLandmarks.length;
    const faces = result.faceLandmarks.map((landmarks, i) => {
      const points = landmarksToOutput(
        landmarks,
        source,
        new Float32Array(landmarks.length * 3),
        this.#width,
        this.#height,
      );
      const blend: Record<string, number> = {};
      for (const category of result.faceBlendshapes?.[i]?.categories ?? [])
        blend[category.categoryName] = category.score;
      return { points, blend };
    });
    track.faces = smooth(track.faces, faces);
  }
}

function smooth(previous: Face[], next: Face[]): Face[] {
  if (previous.length !== next.length) return next;
  return next.map((face, i) => {
    const before = previous[i].points;
    if (before.length !== face.points.length || moved(before, face.points) > 0.25) return face;
    for (let j = 0; j < face.points.length; j++) {
      face.points[j] = before[j] + (face.points[j] - before[j]) * SMOOTHING;
    }
    return face;
  });
}

/** Nose-tip movement relative to face width; a big jump means a different face, so don't blend. */
function moved(a: Float32Array, b: Float32Array): number {
  const width = Math.hypot(b[454 * 3] - b[234 * 3], b[454 * 3 + 1] - b[234 * 3 + 1]) || 1;
  return Math.hypot(a[3] - b[3], a[4] - b[4]) / width;
}
