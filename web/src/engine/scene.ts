import type { BLEND_MODES } from './shaders.ts';
import type { EffectDef } from './types.ts';

export type BlendMode = (typeof BLEND_MODES)[number];

export const SLATE = 'slate';
export const BLACK = 'black';

export interface EffectInstance {
  uid: string;
  type: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Layer {
  uid: string;
  sourceId: string;
  blend: BlendMode;
  opacity: number;
  effects: EffectInstance[];
}

export interface Scene {
  layers: Layer[];
}

let counter = 0;
export const uid = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const newLayer = (sourceId: string, blend: BlendMode = 'normal'): Layer => ({
  uid: uid(),
  sourceId,
  blend,
  opacity: 1,
  effects: [],
});

export const newScene = (sourceId: string = SLATE): Scene => ({ layers: [newLayer(sourceId)] });

export const newEffect = (def: EffectDef): EffectInstance => ({
  uid: uid(),
  type: def.id,
  enabled: true,
  params: Object.fromEntries(def.params.map((p) => [p.key, p.default])),
});

/** Deep copy with fresh uids, so the copy never shares stateful effect buffers with the original. */
export function cloneScene(scene: Scene): Scene {
  return {
    layers: scene.layers.map((layer) => ({
      ...layer,
      uid: uid(),
      effects: cloneEffects(layer.effects),
    })),
  };
}

export const cloneEffects = (effects: EffectInstance[]): EffectInstance[] =>
  effects.map((effect) => ({ ...effect, uid: uid(), params: { ...effect.params } }));

export const sourcesOf = (scene: Scene): string[] => [
  ...new Set(scene.layers.map((layer) => layer.sourceId)),
];
