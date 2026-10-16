import type { EffectDef, TransitionDef } from './types.ts';

// Every file in effects/ and transitions/ registers itself through its default export.
const effectModules = import.meta.glob<EffectDef>('../effects/*.ts', {
  eager: true,
  import: 'default',
});
const transitionModules = import.meta.glob<TransitionDef>('../transitions/*.ts', {
  eager: true,
  import: 'default',
});

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export const effectList: EffectDef[] = Object.values(effectModules).sort(byName);
export const transitionList: TransitionDef[] = Object.values(transitionModules).sort(byName);
export const effects = new Map(effectList.map((def) => [def.id, def]));
export const transitions = new Map(transitionList.map((def) => [def.id, def]));
