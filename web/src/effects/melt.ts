import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'melt',
  name: '🎃 Melt (dripping)',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 0.4, step: 0.005, default: 0.1 },
    { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.01, default: 0.6 },
    { key: 'drips', label: 'Drips', min: 4, max: 60, step: 1, default: 24 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  float column = floor(uv.x * u_drips);
  float r = hash(vec2(column, 17.0));
  float tip = 1.0 - pow(abs(fract(uv.x * u_drips) * 2.0 - 1.0), 2.0);
  float drip = (0.5 + 0.5 * sin(u_time * u_speed * (0.5 + r) + r * 6.2831)) * r * tip;
  float wave = sin(uv.x * 20.0 + u_time * u_speed) * 0.02;
  // Sampling from above makes the picture slide down.
  return texture(u_input, clamp(vec2(uv.x, uv.y + (drip + wave) * u_amount), 0.0, 1.0));
}`,
} satisfies ShaderEffectDef;
