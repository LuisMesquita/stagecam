import type { TransitionDef } from '../engine/types.ts';

export default {
  id: 'wipe',
  name: 'Wipe',
  glsl: `
vec4 transition(vec2 uv) {
  float soft = 0.04;
  float edge = u_progress * (1.0 + 2.0 * soft) - soft;
  float m = 1.0 - smoothstep(edge - soft, edge + soft, uv.x);
  return mix(texture(u_from, uv), texture(u_to, uv), m);
}`,
} satisfies TransitionDef;
