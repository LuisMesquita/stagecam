import { describe, expect, it } from 'vite-plus/test';
import { landmarksToOutput } from '../web/src/faces/geometry.ts';
import type { SourceGeometry } from '../web/src/faces/geometry.ts';
import { headPose } from '../web/src/faces/pose.ts';
import { FACE_TRIANGLES, FACE_UV } from '../web/src/faces/mesh-data.ts';

const W = 1280;
const H = 720;

/** The NORMALIZE shader's mapping from an output uv to an image point (origin top-left). */
function shaderSample(uv: [number, number], g: SourceGeometry): [number, number] | null {
  const rot = g.rotation % 4;
  const aspect = rot % 2 ? 1 / g.aspect : g.aspect;
  const r = aspect / (W / H);
  const size = r > 1 ? [1, 1 / r] : [r, 1];
  let p: [number, number] = [(uv[0] - 0.5) / size[0] + 0.5, (uv[1] - 0.5) / size[1] + 0.5];
  if (p.some((v) => v < 0 || v > 1)) return null;
  if (g.mirror) p = [1 - p[0], p[1]];
  let q = p;
  if (rot === 1) q = [1 - p[1], p[0]];
  else if (rot === 2) q = [1 - p[0], 1 - p[1]];
  else if (rot === 3) q = [p[1], 1 - p[0]];
  return [q[0], 1 - q[1]];
}

describe('landmarksToOutput', () => {
  const cases: SourceGeometry[] = [];
  for (const aspect of [16 / 9, 9 / 16, 4 / 3])
    for (const rotation of [0, 1, 2, 3])
      for (const mirror of [false, true]) cases.push({ aspect, rotation, mirror });

  it.each(cases)(
    'inverts the video shader (aspect $aspect, rotation $rotation, mirror $mirror)',
    (g) => {
      for (const uv of [
        [0.5, 0.5],
        [0.3, 0.6],
        [0.62, 0.21],
        [0.45, 0.9],
      ] as [number, number][]) {
        const image = shaderSample(uv, g);
        if (!image) continue;
        const out = landmarksToOutput(
          [{ x: image[0], y: image[1], z: 0 }],
          g,
          new Float32Array(3),
          W,
          H,
        );
        expect(out[0]).toBeCloseTo(uv[0] * W, 3);
        expect(out[1]).toBeCloseTo(uv[1] * H, 3);
      }
    },
  );

  it('turns MediaPipe depth (negative = closer) into z toward the camera, in pixels', () => {
    const out = landmarksToOutput(
      [{ x: 0.5, y: 0.5, z: -0.1 }],
      { aspect: 16 / 9, rotation: 0, mirror: false },
      new Float32Array(3),
      W,
      H,
    );
    expect(out[2]).toBeCloseTo(128);
  });
});

describe('headPose', () => {
  /** A fake face looking at the camera: cheeks on x, forehead/chin on y, nose sticking out on z. */
  function face(mirror: boolean): Float32Array {
    const points = new Float32Array(478 * 3);
    const set = (i: number, x: number, y: number, z: number) =>
      points.set([mirror ? 1280 - x : x, y, z], i * 3);
    set(234, 540, 360, 0);
    set(454, 740, 360, 0);
    set(10, 640, 480, 0);
    set(152, 640, 220, 0);
    set(1, 640, 350, 60);
    return points;
  }

  it.each([false, true])('points out of the face toward the camera (mirrored %s)', (mirror) => {
    const pose = headPose(face(mirror));
    expect(pose.width).toBeCloseTo(200);
    expect(pose.center[0]).toBeCloseTo(640);
    expect(pose.z[2]).toBeCloseTo(1);
    expect(pose.y[1]).toBeCloseTo(1);
    // Right-handed: x × y = z.
    const [x, y, z] = [pose.x, pose.y, pose.z];
    expect(x[1] * y[2] - x[2] * y[1]).toBeCloseTo(z[0]);
    expect(x[0] * y[1] - x[1] * y[0]).toBeCloseTo(z[2]);
  });
});

describe('face mesh data', () => {
  it('has one UV per landmark and valid triangles', () => {
    expect(FACE_UV.length).toBe(468 * 2);
    expect(FACE_TRIANGLES.length % 3).toBe(0);
    expect(Math.max(...FACE_TRIANGLES)).toBeLessThan(468);
    for (const value of FACE_UV) expect(value >= 0 && value <= 1).toBe(true);
  });
});
