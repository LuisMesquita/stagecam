import type { CustomEffectDef } from '../engine/types.ts';
import { PumpkinHead } from '../faces/pumpkin.ts';

export default {
  kind: 'custom',
  id: 'pumpkin-head',
  name: '🎃 Pumpkin head 3D (face tracking)',
  needsFaces: true,
  params: [
    { key: 'size', label: 'Size', min: 0.6, max: 1.8, step: 0.01, default: 1 },
    { key: 'glow', label: 'Candle glow', min: 0.3, max: 2, step: 0.01, default: 1.2 },
  ],
  create(gpu) {
    let pumpkin: PumpkinHead | null = null;
    return {
      render(input, params, ctx) {
        if (!ctx.faces.length) return input;
        pumpkin ??= new PumpkinHead(gpu);
        const out = gpu.alloc();
        gpu.copy(input, out);
        pumpkin.draw(out, ctx.faces, { size: params.size, glow: params.glow }, ctx);
        return out;
      },
      dispose() {
        pumpkin?.dispose();
      },
    };
  },
} satisfies CustomEffectDef;
