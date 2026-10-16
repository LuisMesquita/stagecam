import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'old-horror-film',
  name: '🎃 Old horror film',
  params: [
    { key: 'grain', label: 'Grain', min: 0, max: 0.5, step: 0.01, default: 0.14 },
    { key: 'scratches', label: 'Scratches & dust', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float frame = mod(floor(u_time * 18.0), 1000.0);
  vec2 p = uv + vec2(0.0, (hash(vec2(frame, 1.0)) - 0.5) * 0.004);
  float l = (luma(texture(u_input, p).rgb) - 0.5) * 1.3 + 0.5;
  l *= 1.0 - u_flicker * 0.25 * hash(vec2(frame, 2.0));
  l += (hash(uv * u_resolution + frame) - 0.5) * u_grain;
  float scratch = 1.0 - smoothstep(0.0, 0.0015, abs(uv.x - hash(vec2(frame, 5.0))));
  l = mix(l, 0.95, scratch * u_scratches * step(0.5, hash(vec2(frame, 6.0))));
  float dust = step(0.997, hash(floor(uv * vec2(60.0, 34.0)) + frame));
  l = mix(l, 0.05, dust * u_scratches);
  vec2 d = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  l *= 1.0 - smoothstep(0.4, 1.0, length(d)) * 0.8;
  return vec4(mix(vec3(l), vec3(l) * vec3(1.07, 0.95, 0.78), u_sepia), 1.0);
}`,
} satisfies ShaderEffectDef;
