import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'night-vision',
  name: '🎃 Night vision',
  params: [
    { key: 'gain', label: 'Gain', min: 1, max: 4, step: 0.05, default: 1.8 },
    { key: 'noise', label: 'Noise', min: 0, max: 0.6, step: 0.01, default: 0.18 },
    { key: 'scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0.75 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float l = luma(texture(u_input, uv).rgb) * u_gain;
  l += (hash(uv * u_resolution + fract(u_time * 7.0) * 100.0) - 0.5) * u_noise;
  l *= 1.0 - u_scanlines * 0.35 * (0.5 + 0.5 * sin(uv.y * u_resolution.y * 1.5));
  vec2 d = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  l *= 1.0 - u_vignette * smoothstep(0.35, 0.95, length(d));
  return vec4(vec3(0.12, 1.0, 0.3) * l, 1.0);
}`,
} satisfies ShaderEffectDef;
