import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'thermal',
  name: '🎃 Thermal camera',
  params: [
    { key: 'contrast', label: 'Contrast', min: 0.5, max: 3, step: 0.01, default: 1.4 },
    { key: 'offset', label: 'Heat offset', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  glsl: `
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0, 0.0, 0.1), b = vec3(0.45, 0.0, 0.6), c = vec3(0.95, 0.1, 0.1);
  vec3 d = vec3(1.0, 0.85, 0.0), e = vec3(1.0);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
vec4 effect(vec2 uv) {
  float l = luma(texture(u_input, uv).rgb);
  return vec4(heat((l - 0.5) * u_contrast + 0.5 + u_offset), 1.0);
}`,
} satisfies ShaderEffectDef;
