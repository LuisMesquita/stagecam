import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'bw-contrast',
  name: 'B&W high contrast',
  params: [
    { key: 'contrast', label: 'Contrast', min: 1, max: 5, step: 0.01, default: 2.2 },
    { key: 'grain', label: 'Grain', min: 0, max: 0.4, step: 0.01, default: 0.08 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float l = luma(texture(u_input, uv).rgb);
  l = (l - 0.5) * u_contrast + 0.5;
  l += (hash(uv * u_resolution + fract(u_time) * 100.0) - 0.5) * u_grain;
  return vec4(vec3(clamp(l, 0.0, 1.0)), 1.0);
}`,
} satisfies ShaderEffectDef;
