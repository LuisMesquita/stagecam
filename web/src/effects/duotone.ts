import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'duotone',
  name: 'Duotone',
  params: [
    { key: 'shadow', label: 'Shadow hue', min: 0, max: 1, step: 0.005, default: 0.72 },
    { key: 'highlight', label: 'Highlight hue', min: 0, max: 1, step: 0.005, default: 0.12 },
    { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  float l = smoothstep(0.05, 0.95, luma(c));
  vec3 dark = hsv2rgb(vec3(u_shadow, 0.9, 0.35));
  vec3 light = hsv2rgb(vec3(u_highlight, 0.6, 1.0));
  return vec4(mix(c, mix(dark, light, l), u_mix), 1.0);
}`,
} satisfies ShaderEffectDef;
