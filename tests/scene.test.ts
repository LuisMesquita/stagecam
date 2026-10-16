import { describe, expect, it } from 'vite-plus/test';
import { effects } from '../web/src/engine/registry.ts';
import { cloneScene, newEffect, newLayer, sourcesOf } from '../web/src/engine/scene.ts';

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
