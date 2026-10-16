import type { Gpu, Mesh, Target } from '../engine/gl.ts';
import { fragment } from '../engine/shaders.ts';
import type { Face } from '../engine/types.ts';
import {
  LEFT_EYE,
  LEFT_IRIS,
  LIPS_INNER,
  MESH_VERTICES,
  RIGHT_EYE,
  RIGHT_IRIS,
} from './landmarks.ts';
import { FACE_TRIANGLES, FACE_UV } from './mesh-data.ts';
import { paintCanvas } from './paint.ts';

/** Places vertices given in output pixels; passes the screen position for sampling the video. */
const MESH_VERTEX = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
uniform vec2 u_resolution;
out vec2 v_uv;
out vec2 v_screen;
void main() {
  v_uv = a_uv;
  v_screen = a_pos.xy / u_resolution;
  gl_Position = vec4(v_screen * 2.0 - 1.0, 0.0, 1.0);
}`;

const PAINT = fragment(`
in vec2 v_screen;
uniform sampler2D u_paint;
uniform sampler2D u_input;
uniform float u_opacity;
uniform float u_shade;
void main() {
  vec4 paint = texture(u_paint, v_uv);
  // Keep the real lighting of the face: the paint darkens where the video is dark.
  float light = luma(texture(u_input, v_screen).rgb);
  vec3 color = paint.rgb * mix(1.0, 0.45 + light * 1.3, u_shade);
  outColor = vec4(color, paint.a * u_opacity);
}`);

const FIRE = fragment(`
uniform float u_amount;
void main() {
  float r = v_uv.x;
  float flicker = 0.75 + 0.25 * hash(vec2(floor(u_time * 20.0), r * 7.0));
  vec3 color = mix(vec3(1.0, 0.92, 0.45), vec3(0.95, 0.18, 0.0), r) * flicker;
  outColor = vec4(color, u_amount * (1.0 - r * 0.4));
}`);

const GLOW = fragment(`
uniform sampler2D u_input;
uniform vec3 u_e0;
uniform vec3 u_e1;
uniform vec3 u_e2;
uniform vec3 u_e3;
uniform vec3 u_e4;
uniform vec3 u_e5;
uniform vec3 u_color;
uniform float u_glow;
uniform float u_darken;
float glowAt(vec3 eye, vec2 px) {
  if (eye.z <= 0.0) return 0.0;
  float d = length(px - eye.xy) / eye.z;
  return exp(-d * d * 3.0) + 0.35 * exp(-d * 1.4);
}
void main() {
  vec2 px = v_uv * u_resolution;
  vec3 c = texture(u_input, v_uv).rgb * (1.0 - u_darken);
  float g = glowAt(u_e0, px) + glowAt(u_e1, px) + glowAt(u_e2, px) + glowAt(u_e3, px)
    + glowAt(u_e4, px) + glowAt(u_e5, px);
  float flicker = 0.88 + 0.12 * sin(u_time * 17.0) * sin(u_time * 5.3);
  c += u_color * g * u_glow * flicker + vec3(1.0) * pow(min(g, 1.0), 4.0) * u_glow * 0.5;
  outColor = vec4(c, 1.0);
}`);

const point = (face: Face, i: number): [number, number] => [
  face.points[i * 3],
  face.points[i * 3 + 1],
];

/** Paints a texture onto each tracked face's 3D mesh, so it follows expressions. */
export class FacePainter {
  #gpu: Gpu;
  #mesh: Mesh;
  #texture: WebGLTexture;

  constructor(gpu: Gpu, paint: (ctx: CanvasRenderingContext2D) => void) {
    this.#gpu = gpu;
    this.#texture = gpu.createTexture();
    gpu.upload(this.#texture, paintCanvas(paint));
    this.#mesh = gpu.createMesh(
      [
        { size: 3, data: new Float32Array(MESH_VERTICES * 3), dynamic: true },
        { size: 2, data: FACE_UV },
      ],
      FACE_TRIANGLES,
    );
  }

  draw(
    target: Target,
    input: Target,
    faces: Face[],
    opacity: number,
    shade: number,
    resolution: readonly [number, number],
  ): void {
    for (const face of faces) {
      this.#gpu.updateMesh(this.#mesh, 0, face.points.subarray(0, MESH_VERTICES * 3));
      this.#gpu.drawMesh(
        this.#mesh,
        MESH_VERTEX,
        PAINT,
        target,
        {
          u_paint: { tex: this.#texture },
          u_input: { tex: input.tex },
          u_opacity: opacity,
          u_shade: shade,
          u_resolution: resolution,
        },
        { blend: 'alpha' },
      );
    }
  }

  dispose(): void {
    this.#gpu.deleteMesh(this.#mesh);
    this.#gpu.gl.deleteTexture(this.#texture);
  }
}

/** Fire inside the open mouth: a fan over the inner lips, which collapses when the mouth closes. */
export class MouthFire {
  #gpu: Gpu;
  #mesh: Mesh;
  #positions = new Float32Array((LIPS_INNER.length + 1) * 3);

  constructor(gpu: Gpu) {
    this.#gpu = gpu;
    const radial = new Float32Array((LIPS_INNER.length + 1) * 2);
    for (let i = 1; i <= LIPS_INNER.length; i++) radial[i * 2] = 1;
    const indices = new Uint16Array(LIPS_INNER.length * 3);
    LIPS_INNER.forEach((_, i) => indices.set([0, i + 1, ((i + 1) % LIPS_INNER.length) + 1], i * 3));
    this.#mesh = gpu.createMesh(
      [
        { size: 3, data: this.#positions, dynamic: true },
        { size: 2, data: radial },
      ],
      indices,
    );
  }

  draw(
    target: Target,
    faces: Face[],
    amount: number,
    ctx: { time: number; resolution: readonly [number, number] },
  ): void {
    for (const face of faces) {
      const open = face.blend.jawOpen ?? 0;
      if (open < 0.05) continue;
      let cx = 0;
      let cy = 0;
      LIPS_INNER.forEach((index, i) => {
        const [x, y] = point(face, index);
        this.#positions.set([x, y, 0], (i + 1) * 3);
        cx += x / LIPS_INNER.length;
        cy += y / LIPS_INNER.length;
      });
      this.#positions.set([cx, cy, 0], 0);
      this.#gpu.updateMesh(this.#mesh, 0, this.#positions);
      this.#gpu.drawMesh(
        this.#mesh,
        MESH_VERTEX,
        FIRE,
        target,
        {
          u_amount: Math.min(1, open * 2) * amount,
          u_time: ctx.time,
          u_resolution: ctx.resolution,
        },
        { blend: 'add' },
      );
    }
  }

  dispose(): void {
    this.#gpu.deleteMesh(this.#mesh);
  }
}

/** Glow centered on each iris (up to 3 faces), with an optional overall darkening. */
export function glowEyes(
  gpu: Gpu,
  input: Target,
  faces: Face[],
  options: { glow: number; size: number; color: [number, number, number]; darken: number },
  ctx: { time: number; resolution: readonly [number, number] },
): Target {
  const eyes: [number, number, number][] = [];
  for (const face of faces.slice(0, 3)) {
    for (const [iris, eye] of [
      [RIGHT_IRIS, RIGHT_EYE],
      [LEFT_IRIS, LEFT_EYE],
    ] as const) {
      const [x, y] = point(face, iris);
      const a = point(face, eye[0]);
      const b = point(face, eye[8]);
      eyes.push([x, y, Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.5 * options.size]);
    }
  }
  while (eyes.length < 6) eyes.push([0, 0, 0]);
  const out = gpu.alloc();
  gpu.draw(GLOW, out, {
    u_input: { tex: input.tex },
    ...Object.fromEntries(eyes.map((eye, i) => [`u_e${i}`, eye])),
    u_color: options.color,
    u_glow: options.glow,
    u_darken: options.darken,
    u_time: ctx.time,
    u_resolution: ctx.resolution,
  });
  return out;
}
