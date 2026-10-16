import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  params: [
    { key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, default: 6 },
    { key: 'spin', label: 'Spin', min: -2, max: 2, step: 0.01, default: 0.2, linkable: false },
    { key: 'zoom', label: 'Zoom', min: 0.3, max: 3, step: 0.01, default: 1 },
  ],
  glsl: `
vec4 effect(vec2 uv) {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;
  float r = length(p);
  float a = atan(p.y, p.x) + u_time * u_spin;
  float seg = 6.2831853 / u_segments;
  a = abs(mod(a, seg) - seg * 0.5);
  vec2 q = vec2(cos(a), sin(a)) * r * u_zoom / aspect + 0.5;
  q = 1.0 - abs(1.0 - mod(q, 2.0));
  return texture(u_input, q);
}`,
} satisfies ShaderEffectDef;
