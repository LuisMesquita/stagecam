import type { Gpu, Mesh, Target } from '../engine/gl.ts';
import { fragment } from '../engine/shaders.ts';
import type { Face } from '../engine/types.ts';
import { headPose } from './pose.ts';

const VERTEX = `#version 300 es
in vec3 a_pos;
uniform vec2 u_resolution;
uniform vec3 u_center;
uniform vec3 u_ax;
uniform vec3 u_ay;
uniform vec3 u_az;
uniform float u_radius;
out vec3 v_model;
out vec3 v_world;
out vec2 v_uv;
void main() {
  vec3 world = u_center + (u_ax * a_pos.x + u_ay * a_pos.y + u_az * a_pos.z) * u_radius;
  v_model = a_pos;
  v_world = world;
  v_uv = world.xy / u_resolution;
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const SHADE = fragment(`
in vec3 v_model;
in vec3 v_world;
uniform float u_glow;
uniform float u_jaw;

bool triangle(vec2 p, vec2 c, float halfBase, float height) {
  float t = (p.y - c.y) / height;
  return t >= 0.0 && t <= 1.0 && abs(p.x - c.x) <= halfBase * (1.0 - t);
}

bool carved(vec2 p, float jaw) {
  if (triangle(p, vec2(-0.32, 0.12), 0.15, 0.22) || triangle(p, vec2(0.32, 0.12), 0.15, 0.22)) return true;
  if (triangle(p, vec2(0.0, -0.08), 0.06, 0.1)) return true;
  float x = abs(p.x);
  if (x > 0.5) return false;
  float mid = -0.3 + 0.28 * p.x * p.x;
  float h = (0.09 + 0.16 * jaw) * (1.0 - pow(x / 0.5, 4.0));
  float teethTop = x < 0.32 ? 0.05 * step(0.5, fract((p.x + 0.5) * 4.0)) : 0.0;
  float teethBottom = x < 0.32 ? 0.05 * step(0.5, fract((p.x + 0.625) * 4.0)) : 0.0;
  return p.y < mid + h - teethTop && p.y > mid - h + teethBottom;
}

void main() {
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  if (n.z < 0.0) n = -n;
  vec3 light = normalize(vec3(-0.4, 0.6, 0.7));
  float diffuse = max(dot(n, light), 0.0);
  bool stem = v_model.y > 0.7 && length(v_model.xz) < 0.13;
  float groove = pow(abs(cos(4.0 * atan(v_model.z, v_model.x))), 10.0);
  vec3 base = stem ? vec3(0.22, 0.28, 0.08) : vec3(1.0, 0.42, 0.04) * (1.0 - groove * 0.4);
  float specular = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
  vec3 color = base * (0.22 + 0.9 * diffuse) + vec3(1.0, 0.8, 0.5) * specular * 0.25;
  if (!stem && v_model.z > 0.25 && carved(v_model.xy, u_jaw)) {
    float flicker = 0.8 + 0.2 * sin(u_time * 13.0) * sin(u_time * 7.3 + 1.0);
    vec3 fire = mix(vec3(1.0, 0.5, 0.03), vec3(1.0, 0.95, 0.55), 0.5 + 0.5 * sin(u_time * 5.0 + v_model.y * 10.0));
    color = fire * flicker * u_glow;
  }
  outColor = vec4(color, 1.0);
}`);

/** Ribbed, slightly squashed sphere with a stem; triangles wind counter-clockwise from outside. */
function pumpkinMesh(): { positions: Float32Array; indices: Uint16Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  const rings = 28;
  const segments = 48;
  for (let i = 0; i <= rings; i++) {
    const lat = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j++) {
      const lon = (j / segments) * Math.PI * 2;
      const groove = Math.pow(Math.abs(Math.cos(4 * lon)), 10);
      const r = 1 - 0.07 * groove;
      positions.push(
        Math.sin(lat) * Math.cos(lon) * r,
        Math.cos(lat) * 0.82,
        Math.sin(lat) * Math.sin(lon) * r,
      );
    }
  }
  const row = segments + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const stemBase = positions.length / 3;
  const stemSegments = 10;
  for (let k = 0; k <= stemSegments; k++) {
    const angle = (k / stemSegments) * Math.PI * 2;
    for (const [y, r] of [
      [0.7, 0.12],
      [1.02, 0.08],
    ]) {
      positions.push(Math.cos(angle) * r, y, Math.sin(angle) * r + 0.02);
    }
  }
  for (let k = 0; k < stemSegments; k++) {
    const a = stemBase + k * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const top = positions.length / 3;
  positions.push(0, 1.02, 0.02);
  for (let k = 0; k < stemSegments; k++)
    indices.push(top, stemBase + k * 2 + 3, stemBase + k * 2 + 1);
  return {
    positions: new Float32Array(positions),
    indices: fixWinding(new Float32Array(positions), indices),
  };
}

/** Makes every triangle face away from the shape's axis, so back-face culling hides the far side. */
function fixWinding(p: Float32Array, indices: number[]): Uint16Array {
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => [
      p[i * 3],
      p[i * 3 + 1],
      p[i * 3 + 2],
    ]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const stem = centroid[1] > 0.69 && Math.hypot(centroid[0], centroid[2] - 0.02) < 0.13;
    const outward = stem ? [centroid[0], centroid[1] > 1.01 ? 1 : 0, centroid[2] - 0.02] : centroid;
    if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
      [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    }
  }
  return new Uint16Array(indices);
}

/** A carved, glowing pumpkin over each face; its mouth opens with the person's jaw. */
export class PumpkinHead {
  #gpu: Gpu;
  #mesh: Mesh;

  constructor(gpu: Gpu) {
    this.#gpu = gpu;
    const { positions, indices } = pumpkinMesh();
    this.#mesh = gpu.createMesh([{ size: 3, data: positions }], indices);
  }

  draw(
    target: Target,
    faces: Face[],
    options: { size: number; glow: number },
    ctx: { time: number; resolution: readonly [number, number] },
  ): void {
    for (const face of faces) {
      const pose = headPose(face.points);
      const lift = pose.width * 0.12;
      this.#gpu.drawMesh(
        this.#mesh,
        VERTEX,
        SHADE,
        target,
        {
          u_center: [
            pose.center[0] + pose.y[0] * lift,
            pose.center[1] + pose.y[1] * lift,
            pose.center[2] + pose.y[2] * lift,
          ],
          u_ax: pose.x,
          u_ay: pose.y,
          u_az: pose.z,
          u_radius: pose.width * 0.72 * options.size,
          u_glow: options.glow,
          u_jaw: Math.min(1, (face.blend.jawOpen ?? 0) * 1.6),
          u_time: ctx.time,
          u_resolution: ctx.resolution,
        },
        { cull: true },
      );
    }
  }

  dispose(): void {
    this.#gpu.deleteMesh(this.#mesh);
  }
}
