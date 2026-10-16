import type { ShaderEffectDef } from '../engine/types.ts';

export default {
  kind: 'shader',
  id: 'possessed',
  name: '🎃 Possessed (glowing edges)',
  params: [
    { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, default: 1.5 },
    { key: 'hue', label: 'Hue', min: 0, max: 1, step: 0.005, default: 0 },
    { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.01, default: 0.4 },
  ],
  glsl: `
float lumaAt(vec2 uv, vec2 offset) { return luma(texture(u_input, uv + offset * 2.0 / u_resolution).rgb); }
vec4 effect(vec2 uv) {
  float tl = lumaAt(uv, vec2(-1, 1)), t = lumaAt(uv, vec2(0, 1)), tr = lumaAt(uv, vec2(1, 1));
  float l = lumaAt(uv, vec2(-1, 0)), r = lumaAt(uv, vec2(1, 0));
  float bl = lumaAt(uv, vec2(-1, -1)), b = lumaAt(uv, vec2(0, -1)), br = lumaAt(uv, vec2(1, -1));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
  float edge = length(vec2(gx, gy));
  float base = 1.0 - luma(texture(u_input, uv).rgb);
  float f = 1.0 - u_flicker * step(0.85, hash(vec2(mod(floor(u_time * 15.0), 1000.0), 3.0)));
  vec3 o = vec3(base * 0.12) + hsv2rgb(vec3(u_hue, 1.0, 1.0)) * edge * u_glow * 2.0;
  return vec4(o * f, 1.0);
}`,
} satisfies ShaderEffectDef;
