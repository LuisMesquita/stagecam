import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'mirror',
  name: 'Mirror',
  params: [
    {
      key: 'axis',
      label: 'Axis (0 = left/right, 1 = top/bottom)',
      min: 0,
      max: 1,
      step: 1,
      default: 0,
    },
    { key: 'flip', label: 'Mirror other side', min: 0, max: 1, step: 1, default: 0 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec2 p = uv;
  if (u_axis < 0.5) {
    p.x = u_flip < 0.5 ? (p.x > 0.5 ? 1.0 - p.x : p.x) : (p.x < 0.5 ? 1.0 - p.x : p.x);
  } else {
    p.y = u_flip < 0.5 ? (p.y < 0.5 ? 1.0 - p.y : p.y) : (p.y > 0.5 ? 1.0 - p.y : p.y);
  }
  return texture(u_input, p);
}`,
} satisfies ShaderEffectDef;
