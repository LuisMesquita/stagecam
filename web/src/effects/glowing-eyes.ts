import type { CustomEffectDef } from '../engine/types.ts';
import { paintBlackEyes } from '../faces/paint.ts';
import { FacePainter, glowEyes } from '../faces/render.ts';

export default {
  kind: 'custom',
  id: 'glowing-eyes',
  name: '🎃 Glowing eyes (face tracking)',
  needsFaces: true,
  params: [
    { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, default: 1.6 },
    { key: 'size', label: 'Size', min: 0.3, max: 3, step: 0.01, default: 1.1 },
    { key: 'hue', label: 'Hue', min: 0, max: 1, step: 0.005, default: 0 },
    { key: 'black', label: 'Black eyes', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'darken', label: 'Darken the rest', min: 0, max: 0.9, step: 0.01, default: 0.35 },
  ],
  create(gpu) {
    let painter: FacePainter | null = null;
    return {
      render(input, params, ctx) {
        if (!ctx.faces.length) return input;
        let base = input;
        if (params.black > 0) {
          painter ??= new FacePainter(gpu, paintBlackEyes);
          base = gpu.alloc();
          gpu.copy(input, base);
          painter.draw(base, input, ctx.faces, params.black, 0, ctx.resolution);
        }
        return glowEyes(
          gpu,
          base,
          ctx.faces,
          { glow: params.glow, size: params.size, color: hue(params.hue), darken: params.darken },
          ctx,
        );
      },
      dispose() {
        painter?.dispose();
      },
    };
  },
} satisfies CustomEffectDef;

function hue(h: number): [number, number, number] {
  const channel = (offset: number) =>
    Math.min(1, Math.max(0, Math.abs(((h + offset) % 1) * 6 - 3) - 1));
  return [channel(0), channel(2 / 3), channel(1 / 3)];
}
