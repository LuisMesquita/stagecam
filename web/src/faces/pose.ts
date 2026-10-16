import { CHEEK_LEFT, CHEEK_RIGHT, CHIN, FOREHEAD, NOSE_TIP } from './landmarks.ts';

export type Vec3 = [number, number, number];

/** Head position and orientation in output pixels; `z` points out of the face toward the camera. */
export interface HeadPose {
  center: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
  /** Cheek-to-cheek width in pixels. */
  width: number;
}

const at = (points: Float32Array, i: number): Vec3 => [
  points[i * 3],
  points[i * 3 + 1],
  points[i * 3 + 2],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** Builds a right-handed head frame from the cheeks, forehead, chin and nose tip. */
export function headPose(points: Float32Array): HeadPose {
  const right = at(points, CHEEK_RIGHT);
  const left = at(points, CHEEK_LEFT);
  const top = at(points, FOREHEAD);
  const bottom = at(points, CHIN);
  const center = scale([right[0] + left[0], right[1] + left[1], right[2] + left[2]], 0.5);
  let x = normalize(sub(left, right));
  const up = sub(top, bottom);
  const y = normalize(sub(up, scale(x, dot(up, x))));
  let z = cross(x, y);
  // Whatever the mirroring, the face looks out toward the nose tip.
  if (dot(z, sub(at(points, NOSE_TIP), center)) < 0) z = scale(z, -1);
  x = cross(y, z);
  return { center, x, y, z, width: length(sub(left, right)) };
}
