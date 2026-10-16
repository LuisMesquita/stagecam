import type { TransitionDef } from '../engine/types.ts';

export default {
  id: 'glitch',
  name: 'Glitch',
  glsl: `
vec4 transition(vec2 uv) {
  float intensity = sin(u_progress * 3.14159);
  float t = floor(u_time * 24.0);
  vec2 block = floor(uv * vec2(12.0, 20.0));
  float r = hash(block + t);
  vec2 p = uv + vec2((hash(vec2(block.y, t)) - 0.5) * 0.3 * intensity * step(0.6, r), 0.0);
  p.x = fract(p.x);
  bool showTo = hash(block * 1.7) < u_progress;
  float s = 0.02 * intensity;
  vec3 from = vec3(texture(u_from, p + vec2(s, 0.0)).r, texture(u_from, p).g, texture(u_from, p - vec2(s, 0.0)).b);
  vec3 to = vec3(texture(u_to, p + vec2(s, 0.0)).r, texture(u_to, p).g, texture(u_to, p - vec2(s, 0.0)).b);
  return vec4(showTo ? to : from, 1.0);
}`,
} satisfies TransitionDef;
