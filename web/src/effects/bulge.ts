import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'bulge',
  name: '🎃 Funhouse bulge',
  params: [
    { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'radius', label: 'Radius', min: 0.2, max: 1.2, step: 0.01, default: 0.7 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 d = (uv - 0.5) * aspect;
  float r = length(d) / u_radius;
  float f = r < 1.0 ? mix(1.0, smoothstep(0.0, 1.0, r), u_strength) : 1.0;
  return texture(u_input, d * f / aspect + 0.5);
}`,
} satisfies ShaderEffectDef;
