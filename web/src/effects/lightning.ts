import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'lightning',
  name: '🎃 Lightning storm',
  params: [
    { key: 'chance', label: 'Random strikes', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'strike', label: 'Strike (link to beat)', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  glsl: `
float struck(float bucket) { return step(1.0 - u_chance * 0.15, hash(vec2(bucket, 9.0))); }
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  float bucket = floor(u_time * 10.0);
  float flash = clamp(max(struck(bucket), u_strike) + struck(bucket - 1.0) * 0.35, 0.0, 1.0);
  vec3 lit = mix(c, vec3(1.0) - c * 0.3, 0.85);
  vec3 dark = c * (1.0 - u_darkness * 0.7) * vec3(0.75, 0.8, 1.0);
  return vec4(mix(dark, lit, flash), 1.0);
}`,
} satisfies ShaderEffectDef;
