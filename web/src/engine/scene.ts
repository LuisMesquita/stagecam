import type { BLEND_MODES } from './shaders.ts';
import type { EffectDef, ParamDef } from './types.ts';

export type BlendMode = (typeof BLEND_MODES)[number];

export const SLATE = 'slate';
export const BLACK = 'black';

export const SIGNALS = ['bass', 'mid', 'high', 'level', 'beat'] as const;
export type SignalName = (typeof SIGNALS)[number];
/** Live audio signals, each 0–1. */
export type Signals = Record<SignalName, number>;
export const SILENCE: Signals = { bass: 0, mid: 0, high: 0, level: 0, beat: 0 };

/** Moves a slider away from its resting value with the music. `amount` is -1–1 of the slider range. */
export interface AudioMod {
  signal: SignalName;
  amount: number;
}

export interface EffectInstance {
  uid: string;
  type: string;
  enabled: boolean;
  params: Record<string, number>;
  /** Audio links keyed by param key. */
  mods?: Record<string, AudioMod>;
}

export interface Layer {
  uid: string;
  sourceId: string;
  blend: BlendMode;
  opacity: number;
  effects: EffectInstance[];
  opacityMod?: AudioMod;
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
      opacityMod: layer.opacityMod && { ...layer.opacityMod },
    })),
  };
}

export const cloneEffects = (effects: EffectInstance[]): EffectInstance[] =>
  effects.map((effect) => ({
    ...effect,
    uid: uid(),
    params: { ...effect.params },
    mods: effect.mods && structuredClone(effect.mods),
  }));

export const OPACITY_PARAM: ParamDef = {
  key: 'opacity',
  label: 'Opacity',
  min: 0,
  max: 1,
  step: 0.01,
  default: 1,
};

/** The value a slider has right now: its resting value pushed by the linked audio signal. */
export function modulate(
  base: number,
  param: ParamDef,
  mod: AudioMod | undefined,
  signals: Signals,
): number {
  if (!mod || mod.amount === 0) return base;
  const value = base + mod.amount * (param.max - param.min) * signals[mod.signal];
  const clamped = Math.min(param.max, Math.max(param.min, value));
  return param.step === 1 ? Math.round(clamped) : clamped;
}

export const sourcesOf = (scene: Scene): string[] => [
  ...new Set(scene.layers.map((layer) => layer.sourceId)),
];
