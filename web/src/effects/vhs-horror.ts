import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'vhs-horror',
  name: '🎃 VHS horror tape',
  params: [
    { key: 'tracking', label: 'Tracking errors', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'bleed', label: 'Color bleed', min: 0, max: 0.02, step: 0.0005, default: 0.006 },
    { key: 'noise', label: 'Noise', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float t = u_time;
  float frame = floor(t * 30.0);
  float wob = (sin(uv.y * 30.0 + t * 3.0) * 0.002 + sin(uv.y * 3.0 + t) * 0.003) * u_wobble;
  float band = 1.0 - smoothstep(0.0, 0.03, abs(uv.y - fract(t * 0.15)));
  float tear = band * u_tracking * 0.2 * (hash(vec2(floor(uv.y * 200.0), frame)) - 0.5);
  vec2 p = vec2(uv.x + wob + tear, uv.y);
  vec3 c = vec3(
    texture(u_input, p + vec2(u_bleed, 0.0)).r,
    texture(u_input, p).g,
    texture(u_input, p - vec2(u_bleed, 0.0)).b
  );
  c = mix(c, vec3(luma(c)), 0.35);
  c += (hash(vec2(uv.y * u_resolution.y, frame)) - 0.5) * u_noise * 0.3;
  c += band * u_tracking * 0.45 * hash(uv * u_resolution + t);
  c *= 0.92 + 0.08 * sin(uv.y * u_resolution.y * 0.8);
  return vec4(c, 1.0);
}`,
} satisfies ShaderEffectDef;
