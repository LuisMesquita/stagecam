import { describe, expect, it } from 'vite-plus/test';
import { effects } from '../web/src/engine/registry.ts';
import { cloneScene, modulate, newEffect, newLayer, sourcesOf } from '../web/src/engine/scene.ts';

describe('cloneScene', () => {
  it('deep-copies layers and effects with fresh uids', () => {
    const layer = newLayer('cam-a');
    layer.effects.push(newEffect(effects.get('frame-delay')!));
    const scene = { layers: [layer, newLayer('cam-b', 'screen')] };

    const copy = cloneScene(scene);

    expect(copy).not.toBe(scene);
    expect(copy.layers.map((l) => l.sourceId)).toEqual(['cam-a', 'cam-b']);
    expect(copy.layers[0].uid).not.toBe(layer.uid);
    expect(copy.layers[0].effects[0].uid).not.toBe(layer.effects[0].uid);
    copy.layers[0].effects[0].params.seconds = 2.5;
    expect(layer.effects[0].params.seconds).toBe(1);
  });

  it('lists each source once', () => {
    const scene = { layers: [newLayer('a'), newLayer('b'), newLayer('a')] };
    expect(sourcesOf(scene)).toEqual(['a', 'b']);
  });
});

describe('modulate', () => {
  const param = { key: 'amount', label: 'Amount', min: 0, max: 4, default: 1 };
  const signals = { bass: 0.5, mid: 0, high: 0, level: 1, beat: 0 };

  it('returns the resting value without a link', () => {
    expect(modulate(1, param, undefined, signals)).toBe(1);
    expect(modulate(1, param, { signal: 'bass', amount: 0 }, signals)).toBe(1);
  });

  it('pushes by amount × range × signal and clamps', () => {
    expect(modulate(1, param, { signal: 'bass', amount: 0.5 }, signals)).toBe(2);
    expect(modulate(1, param, { signal: 'level', amount: 1 }, signals)).toBe(4);
    expect(modulate(1, param, { signal: 'level', amount: -1 }, signals)).toBe(0);
  });

  it('rounds stepped params', () => {
    const segments = { key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, default: 6 };
    expect(modulate(6, segments, { signal: 'bass', amount: 0.25 }, signals)).toBe(8);
  });

  it('cloneScene deep-copies audio links', () => {
    const layer = newLayer('cam');
    layer.opacityMod = { signal: 'beat', amount: 1 };
    const effect = newEffect(effects.get('oversaturate')!);
    effect.mods = { amount: { signal: 'bass', amount: 0.5 } };
    layer.effects.push(effect);
    const copy = cloneScene({ layers: [layer] });
    copy.layers[0].opacityMod!.amount = 0;
    copy.layers[0].effects[0].mods!.amount.amount = 0;
    expect(layer.opacityMod.amount).toBe(1);
    expect(effect.mods.amount.amount).toBe(0.5);
  });
});
