import type { TransitionDef } from '../engine/types.ts';

export default {
  id: 'crossfade',
  name: 'Crossfade',
  glsl: `
vec4 transition(vec2 uv) {
  float p = smoothstep(0.0, 1.0, u_progress);
  return mix(texture(u_from, uv), texture(u_to, uv), p);
}`,
} satisfies TransitionDef;
