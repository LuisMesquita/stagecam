import type { Target } from '../engine/gl.ts';
import { MIX } from '../engine/shaders.ts';
import type { CustomEffectDef } from '../engine/types.ts';

const RECORD_FPS = 30;
const MAX_SECONDS = 3;

/** Keeps a time-stamped ring of past frames and shows the one from `seconds` ago. */
export default {
  kind: 'custom',
  id: 'frame-delay',
  name: 'Frame delay / echo',
  params: [
    { key: 'seconds', label: 'Delay (s)', min: 0.1, max: MAX_SECONDS, step: 0.05, default: 1 },
    {
      key: 'mix',
      label: 'Mix with live (1 = delayed only)',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
    },
  ],
  create(gpu) {
    const frames: { target: Target; at: number }[] = [];
    let lastRecord = -Infinity;
    // Audio links move `seconds` every frame: shrink the ring slowly so a dip doesn't drop history
    // and the next beat still finds the older frames it reaches back for.
    let keepSeconds = 0;
    let lastRender = 0;
    return {
      render(input, params, ctx) {
        const seconds = Math.min(params.seconds, MAX_SECONDS);
        keepSeconds = Math.max(seconds, keepSeconds - (ctx.time - lastRender) / 2);
        lastRender = ctx.time;
        const capacity = Math.ceil(keepSeconds * RECORD_FPS) + 2;
        while (frames.length > capacity) gpu.deleteTarget(frames.shift()!.target);
        if (ctx.time - lastRecord >= 1 / RECORD_FPS - 0.002) {
          lastRecord = ctx.time;
          const slot =
            frames.length >= capacity ? frames.shift()! : { target: gpu.createTarget(), at: 0 };
          gpu.copy(input, slot.target);
          slot.at = ctx.time;
          frames.push(slot);
        }
        const wanted = ctx.time - seconds;
        let picked = frames[0];
        for (let i = frames.length - 1; i >= 0; i--) {
          if (frames[i].at <= wanted) {
            picked = frames[i];
            break;
          }
        }
        if (params.mix >= 0.999) return picked.target;
        const out = gpu.alloc();
        gpu.draw(MIX, out, {
          u_a: { tex: input.tex },
          u_b: { tex: picked.target.tex },
          u_mix: params.mix,
        });
        return out;
      },
      dispose() {
        for (const frame of frames) gpu.deleteTarget(frame.target);
        frames.length = 0;
      },
    };
  },
} satisfies CustomEffectDef;
