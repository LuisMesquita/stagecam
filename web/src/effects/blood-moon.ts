import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'blood-moon',
  name: '🎃 Blood moon',
  params: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'pulse', label: 'Pulse (link to beat)', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec3 c = texture(u_input, uv).rgb;
  float l = smoothstep(0.05, 0.9, luma(c));
  vec3 blood = mix(vec3(0.02, 0.0, 0.0), vec3(1.0, 0.12, 0.05), l);
  blood = mix(blood, vec3(1.0, 0.85, 0.7), smoothstep(0.85, 1.0, l));
  vec3 o = mix(c, blood, u_intensity);
  vec2 d = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  o *= 1.0 - u_vignette * smoothstep(0.3, 0.9, length(d));
  o += vec3(0.35, 0.0, 0.0) * u_pulse;
  return vec4(o, 1.0);
}`,
} satisfies ShaderEffectDef;
