import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'rgb-glitch',
  name: 'RGB split / glitch',
  params: [
    { key: 'split', label: 'RGB split', min: 0, max: 0.05, step: 0.001, default: 0.012 },
    { key: 'glitch', label: 'Glitch', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.01, default: 1, linkable: false },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float t = mod(floor(u_time * u_speed * 12.0), 1000.0);
  float band = floor(uv.y * 28.0);
  float r = hash(vec2(band, t));
  float shift = r > 1.0 - u_glitch * 0.45 ? (hash(vec2(t, band)) - 0.5) * 0.25 * u_glitch : 0.0;
  vec2 p = vec2(fract(uv.x + shift), uv.y);
  float s = u_split * (1.0 + 3.0 * step(0.9, hash(vec2(t, 7.0))) * u_glitch);
  float R = texture(u_input, p + vec2(s, 0.0)).r;
  float G = texture(u_input, p).g;
  float B = texture(u_input, p - vec2(s, 0.0)).b;
  return vec4(R, G, B, 1.0);
}`,
} satisfies ShaderEffectDef;
