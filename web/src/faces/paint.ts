import { FACE_UV } from './mesh-data.ts';
import {
  FACE_OVAL,
  LEFT_BROW,
  LEFT_EYE,
  LIPS_OUTER,
  NOSE_CAVITY,
  RIGHT_BROW,
  RIGHT_EYE,
} from './landmarks.ts';

export const PAINT_SIZE = 1024;
type Point = [number, number];

/** A landmark's position on the paint canvas (canvas y runs down, UV v runs up). */
const uv = (i: number): Point => [
  FACE_UV[i * 2] * PAINT_SIZE,
  (1 - FACE_UV[i * 2 + 1]) * PAINT_SIZE,
];

function centroid(indices: number[]): Point {
  const points = indices.map(uv);
  return [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];
}

function path(
  ctx: CanvasRenderingContext2D,
  indices: number[],
  grow = 1,
  offset: Point = [0, 0],
): void {
  const [cx, cy] = centroid(indices);
  ctx.beginPath();
  indices.forEach((i, n) => {
    const [x, y] = uv(i);
    const px = cx + (x - cx) * grow + offset[0];
    const py = cy + (y - cy) * grow + offset[1];
    if (n === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function blob(ctx: CanvasRenderingContext2D, center: Point, radius: number, color: string): void {
  const gradient = ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(center[0] - radius, center[1] - radius, radius * 2, radius * 2);
}

const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

function faceBase(ctx: CanvasRenderingContext2D, center: string, edge: string): void {
  const [cx, cy] = centroid(FACE_OVAL);
  const gradient = ctx.createRadialGradient(
    cx,
    cy * 0.9,
    PAINT_SIZE * 0.1,
    cx,
    cy,
    PAINT_SIZE * 0.55,
  );
  gradient.addColorStop(0, center);
  gradient.addColorStop(1, edge);
  ctx.save();
  ctx.filter = 'blur(10px)';
  path(ctx, FACE_OVAL, 0.98);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function eyeSockets(ctx: CanvasRenderingContext2D, grow: number, blur: number): void {
  for (const eye of [RIGHT_EYE, LEFT_EYE]) {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    path(ctx, eye, grow * 1.15, [0, -6]);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    ctx.restore();
    path(ctx, eye, grow, [0, -4]);
    ctx.fillStyle = '#000';
    ctx.fill();
  }
}

export function paintSkull(ctx: CanvasRenderingContext2D): void {
  faceBase(ctx, 'rgba(240,236,226,0.95)', 'rgba(150,140,125,0.85)');
  // Hollow cheeks and temples.
  for (const [a, b] of [
    [50, 61],
    [280, 291],
  ]) {
    blob(ctx, mix(uv(a), uv(b), 0.45), PAINT_SIZE * 0.09, 'rgba(45,38,32,0.75)');
  }
  blob(ctx, uv(21), PAINT_SIZE * 0.06, 'rgba(60,52,44,0.6)');
  blob(ctx, uv(251), PAINT_SIZE * 0.06, 'rgba(60,52,44,0.6)');
  eyeSockets(ctx, 2.1, 16);
  ctx.save();
  ctx.filter = 'blur(3px)';
  path(ctx, NOSE_CAVITY, 1.25, [0, 4]);
  ctx.fillStyle = '#050403';
  ctx.fill();
  ctx.restore();

  // Teeth across the mouth: a dark band, two rows of teeth, black gaps.
  const leftCorner = uv(61);
  const rightCorner = uv(291);
  const top = uv(0)[1] - 6;
  const bottom = uv(17)[1] + 8;
  const middle = (uv(13)[1] + uv(14)[1]) / 2;
  const x0 = leftCorner[0] - 18;
  const x1 = rightCorner[0] + 18;
  ctx.fillStyle = '#1c1612';
  ctx.beginPath();
  ctx.roundRect(x0, top, x1 - x0, bottom - top, 18);
  ctx.fill();
  const teeth = 10;
  for (let row = 0; row < 2; row++) {
    for (let t = 0; t < teeth; t++) {
      const w = (x1 - x0) / teeth;
      const tx = x0 + t * w + 2;
      const ty = row === 0 ? top + 3 : middle + 2;
      const th = (row === 0 ? middle - top : bottom - middle) - 5;
      ctx.fillStyle = '#efe9da';
      ctx.beginPath();
      ctx.roundRect(tx, ty, w - 4, th, 5);
      ctx.fill();
    }
  }
  // Cracks on the forehead.
  ctx.strokeStyle = 'rgba(30,25,20,0.8)';
  ctx.lineWidth = 3;
  const [fx, fy] = uv(151);
  ctx.beginPath();
  ctx.moveTo(fx + 30, fy - 60);
  ctx.lineTo(fx + 10, fy - 20);
  ctx.lineTo(fx + 28, fy + 10);
  ctx.lineTo(fx + 8, fy + 50);
  ctx.stroke();
}

export function paintDemon(ctx: CanvasRenderingContext2D): void {
  faceBase(ctx, 'rgba(150,18,14,0.9)', 'rgba(40,0,0,0.92)');
  for (const [a, b] of [
    [50, 61],
    [280, 291],
  ]) {
    blob(ctx, mix(uv(a), uv(b), 0.4), PAINT_SIZE * 0.1, 'rgba(10,0,0,0.8)');
  }
  // Sharp, raised brows.
  for (const brow of [RIGHT_BROW, LEFT_BROW]) {
    path(ctx, brow, 1.5, [0, -18]);
    ctx.fillStyle = '#080000';
    ctx.fill();
  }
  eyeSockets(ctx, 1.5, 12);
  path(ctx, LIPS_OUTER, 1.08);
  ctx.fillStyle = '#0a0000';
  ctx.fill();
  // Dark veins rising from the brows.
  ctx.strokeStyle = 'rgba(20,0,0,0.85)';
  ctx.lineCap = 'round';
  for (const [start, dx] of [
    [107, -1],
    [336, 1],
  ] as const) {
    const [x, y] = uv(start);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y - 30);
    ctx.quadraticCurveTo(x + dx * 40, y - 120, x + dx * 20, y - 200);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + dx * 25, y - 110);
    ctx.lineTo(x + dx * 70, y - 160);
    ctx.stroke();
  }
}

/** Only the eyes, filled black: used under the glowing-eyes effect. */
export function paintBlackEyes(ctx: CanvasRenderingContext2D): void {
  eyeSockets(ctx, 1.25, 6);
}

export function paintCanvas(paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PAINT_SIZE;
  paint(canvas.getContext('2d')!);
  return canvas;
}
