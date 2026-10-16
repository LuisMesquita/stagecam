import type { CustomEffectDef } from '../engine/types.ts';
import { paintDemon } from '../faces/paint.ts';
import { FacePainter, MouthFire, glowEyes } from '../faces/render.ts';

export default {
  kind: 'custom',
  id: 'demon-mask',
  name: '🎃 Demon face (face tracking)',
  needsFaces: true,
  params: [
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'eyes', label: 'Eye glow', min: 0, max: 3, step: 0.01, default: 1.4 },
    { key: 'fire', label: 'Mouth fire', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  create(gpu) {
    let painter: FacePainter | null = null;
    let fire: MouthFire | null = null;
    return {
      render(input, params, ctx) {
        if (!ctx.faces.length) return input;
        painter ??= new FacePainter(gpu, paintDemon);
        fire ??= new MouthFire(gpu);
        const painted = gpu.alloc();
        gpu.copy(input, painted);
        painter.draw(painted, input, ctx.faces, params.opacity, 0.6, ctx.resolution);
        fire.draw(painted, ctx.faces, params.fire, ctx);
        return glowEyes(
          gpu,
          painted,
          ctx.faces,
          { glow: params.eyes, size: 0.9, color: [1, 0.25, 0.02], darken: 0 },
          ctx,
        );
      },
      dispose() {
        painter?.dispose();
        fire?.dispose();
      },
    };
  },
} satisfies CustomEffectDef;
