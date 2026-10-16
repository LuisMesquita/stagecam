import type { Target } from '../engine/gl.ts';
import { fragment } from '../engine/shaders.ts';
import type { CustomEffectDef } from '../engine/types.ts';

const TRAIL = fragment(`
uniform sampler2D u_input;
uniform sampler2D u_prev;
uniform float u_keep;
uniform float u_tint;
uniform float u_drift;
void main() {
  vec3 c = texture(u_input, v_uv).rgb;
  vec3 p = texture(u_prev, v_uv - vec2(0.0, u_drift)).rgb * u_keep;
  vec3 ghost = mix(p, vec3(luma(p)) * vec3(0.6, 0.85, 1.25), u_tint);
  outColor = vec4(max(c, ghost), 1.0);
}`);

/** Feedback loop: bright moving shapes leave fading, bluish echoes that float upward. */
export default {
  kind: 'custom',
  id: 'ghost-trails',
  name: '🎃 Ghost trails',
  params: [
    { key: 'decay', label: 'Trail length', min: 0.5, max: 0.98, step: 0.005, default: 0.9 },
    { key: 'tint', label: 'Ghostly tint', min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: 'drift', label: 'Float upward', min: 0, max: 0.01, step: 0.0001, default: 0.0015 },
  ],
  create(gpu) {
    let buffers: [Target, Target] | null = null;
    let lastTime = 0;
    return {
      render(input, params, ctx) {
        buffers ??= [gpu.createTarget(), gpu.createTarget()];
        const [prev, next] = buffers;
        // Normalize the decay to 60 fps so trails look the same at any frame rate.
        const dt = Math.min(0.1, Math.max(0, ctx.time - lastTime));
        lastTime = ctx.time;
        gpu.draw(TRAIL, next, {
          u_input: { tex: input.tex },
          u_prev: { tex: prev.tex },
          u_keep: Math.pow(params.decay, dt * 60),
          u_tint: params.tint,
          u_drift: params.drift * dt * 60,
          u_time: ctx.time,
          u_resolution: ctx.resolution,
        });
        buffers = [next, prev];
        return next;
      },
      dispose() {
        if (buffers) buffers.forEach((target) => gpu.deleteTarget(target));
        buffers = null;
      },
    };
  },
} satisfies CustomEffectDef;
