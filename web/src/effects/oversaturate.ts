import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'oversaturate',
  name: 'Over-saturation',
  params: [
    { key: 'amount', label: 'Saturation', min: 0, max: 4, step: 0.01, default: 2.2 },
    { key: 'contrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01, default: 1.15 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  vec3 s = mix(vec3(luma(c)), c, u_amount);
  s = (s - 0.5) * u_contrast + 0.5;
  return vec4(clamp(s, 0.0, 1.0), 1.0);
}`,
} satisfies ShaderEffectDef;
