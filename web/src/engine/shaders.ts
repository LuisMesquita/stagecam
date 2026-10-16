import type { ParamDef, ShaderEffectDef, TransitionDef } from './types.ts';

const HEADER = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;
`;

/** Helpers available to every effect and transition. */
const LIBRARY = `
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;

const paramUniforms = (params: ParamDef[]) =>
  params.map((p) => `uniform float u_${p.key};`).join('\n');

export function effectSource(def: ShaderEffectDef): string {
  return `${HEADER}uniform sampler2D u_input;
${paramUniforms(def.params)}
${LIBRARY}
${def.glsl}
void main() { outColor = vec4(effect(v_uv).rgb, 1.0); }`;
}

export function transitionSource(def: TransitionDef): string {
  return `${HEADER}uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
${LIBRARY}
${def.glsl}
void main() { outColor = vec4(transition(v_uv).rgb, 1.0); }`;
}

/**
 * Rotates the source by quarter turns clockwise, fits it into 16:9 with black borders
 * and optionally mirrors it horizontally.
 */
export const NORMALIZE = `${HEADER}uniform sampler2D u_input;
uniform float u_srcAspect;
uniform float u_mirror;
uniform float u_rotation;
void main() {
  int rot = int(u_rotation + 0.5);
  float aspect = (rot == 1 || rot == 3) ? 1.0 / u_srcAspect : u_srcAspect;
  float r = aspect / (u_resolution.x / u_resolution.y);
  vec2 size = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
  vec2 p = (v_uv - 0.5) / size + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (u_mirror > 0.5) p.x = 1.0 - p.x;
  vec2 q = p;
  if (rot == 1) q = vec2(1.0 - p.y, p.x);
  else if (rot == 2) q = 1.0 - p;
  else if (rot == 3) q = vec2(p.y, 1.0 - p.x);
  outColor = vec4(texture(u_input, q).rgb, 1.0);
}`;

export const BLEND_MODES = [
  'normal',
  'add',
  'screen',
  'multiply',
  'difference',
  'overlay',
  'lighten',
] as const;

export const BLEND = `${HEADER}uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_opacity;
uniform float u_mode;
void main() {
  vec3 b = texture(u_base, v_uv).rgb;
  vec3 l = texture(u_layer, v_uv).rgb;
  int m = int(u_mode + 0.5);
  vec3 r = l;
  if (m == 1) r = min(b + l, 1.0);
  else if (m == 2) r = 1.0 - (1.0 - b) * (1.0 - l);
  else if (m == 3) r = b * l;
  else if (m == 4) r = abs(b - l);
  else if (m == 5) r = mix(2.0 * b * l, 1.0 - 2.0 * (1.0 - b) * (1.0 - l), step(0.5, b));
  else if (m == 6) r = max(b, l);
  outColor = vec4(mix(b, r, u_opacity), 1.0);
}`;

export const MIX = `${HEADER}uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_mix;
void main() { outColor = vec4(mix(texture(u_a, v_uv).rgb, texture(u_b, v_uv).rgb, u_mix), 1.0); }`;
