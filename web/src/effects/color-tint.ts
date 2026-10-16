import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'color-tint',
  name: 'Color tint',
  params: [
    { key: 'hue', label: 'Hue', min: 0, max: 1, step: 0.005, default: 0.85 },
    { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.6 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  vec3 tint = hsv2rgb(vec3(u_hue, 0.85, 1.0));
  vec3 tinted = luma(c) * tint * 1.6;
  return vec4(mix(c, clamp(tinted, 0.0, 1.0), u_strength), 1.0);
}`,
} satisfies ShaderEffectDef;
