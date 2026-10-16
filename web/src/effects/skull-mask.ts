import type { CustomEffectDef } from '../engine/types.ts';
import { paintSkull } from '../faces/paint.ts';
import { FacePainter } from '../faces/render.ts';

export default {
  kind: 'custom',
  id: 'skull-mask',
  name: '🎃 Skull face (face tracking)',
  needsFaces: true,
  params: [
    { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 0.92 },
    { key: 'shade', label: 'Keep real lighting', min: 0, max: 1, step: 0.01, default: 0.7 },
  ],
  create(gpu) {
    let painter: FacePainter | null = null;
    return {
      render(input, params, ctx) {
        if (!ctx.faces.length) return input;
        painter ??= new FacePainter(gpu, paintSkull);
        const out = gpu.alloc();
        gpu.copy(input, out);
        painter.draw(out, input, ctx.faces, params.opacity, params.shade, ctx.resolution);
        return out;
      },
      dispose() {
        painter?.dispose();
      },
    };
  },
} satisfies CustomEffectDef;
