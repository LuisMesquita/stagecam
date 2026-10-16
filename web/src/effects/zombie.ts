import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'zombie',
  name: '🎃 Zombie skin',
  params: [
    { key: 'rot', label: 'Rot', min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: 'veins', label: 'Veins', min: 0, max: 1, step: 0.01, default: 0.45 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  float l = luma(c);
  vec3 sick = (vec3(l * 0.75, l * 0.95 + 0.03, l * 0.6) - 0.5) * 1.25 + 0.5;
  float n = sin(uv.x * 90.0 + sin(uv.y * 40.0) * 3.0) * sin(uv.y * 70.0 + sin(uv.x * 30.0) * 2.0);
  sick *= 1.0 - smoothstep(0.92, 1.0, abs(n)) * u_veins * 0.6 * smoothstep(0.2, 0.7, l);
  return vec4(mix(c, sick, u_rot), 1.0);
}`,
} satisfies ShaderEffectDef;
