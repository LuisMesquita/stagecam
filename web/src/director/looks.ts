import type { AudioMod } from '../engine/scene.ts';

export type Energy = 'calm' | 'mid' | 'wild';

export interface LookEffect {
  type: string;
  params?: Record<string, number>;
  mods?: Record<string, AudioMod>;
}

/** A named effect combo the auto director can put on a shot. Add yours to the list. */
export interface Look {
  name: string;
  energy: Energy[];
  halloween?: boolean;
  effects: LookEffect[];
}

const beat = (amount: number): AudioMod => ({ signal: 'beat', amount });
const bass = (amount: number): AudioMod => ({ signal: 'bass', amount });
const level = (amount: number): AudioMod => ({ signal: 'level', amount });

export const LOOKS: Look[] = [
  { name: 'Clean', energy: ['calm', 'mid'], effects: [] },
  {
    name: 'Punchy',
    energy: ['mid', 'wild'],
    effects: [{ type: 'oversaturate', params: { amount: 1.8 }, mods: { amount: bass(0.3) } }],
  },
  {
    name: 'Neon kaleidoscope',
    energy: ['wild'],
    effects: [
      { type: 'kaleidoscope', params: { segments: 6, spin: 0.3 }, mods: { zoom: beat(0.15) } },
      { type: 'color-tint', params: { hue: 0.8, strength: 0.5 }, mods: { hue: level(0.2) } },
    ],
  },
  {
    name: 'Glitch storm',
    energy: ['wild'],
    effects: [
      { type: 'rgb-glitch', params: { split: 0.01, glitch: 0.2 }, mods: { glitch: beat(0.7) } },
    ],
  },
  {
    name: 'Duotone pulse',
    energy: ['mid'],
    effects: [
      { type: 'duotone', params: { shadow: 0.72, highlight: 0.12 }, mods: { mix: beat(-0.4) } },
    ],
  },
  {
    name: 'Echo',
    energy: ['calm', 'mid'],
    effects: [{ type: 'frame-delay', params: { seconds: 0.5, mix: 0.5 } }],
  },
  {
    name: 'Mirror world',
    energy: ['mid', 'wild'],
    effects: [{ type: 'mirror' }, { type: 'oversaturate', params: { amount: 1.6 } }],
  },
  { name: 'B&W drama', energy: ['calm', 'mid'], effects: [{ type: 'bw-contrast' }] },

  {
    name: 'Found footage',
    halloween: true,
    energy: ['mid'],
    effects: [{ type: 'vhs-horror', params: { tracking: 0.3 }, mods: { tracking: beat(0.6) } }],
  },
  {
    name: 'Cursed tape',
    halloween: true,
    energy: ['calm', 'mid'],
    effects: [
      { type: 'vhs-horror', params: { tracking: 0.2, noise: 0.5 } },
      { type: 'bw-contrast', params: { contrast: 1.6, grain: 0.1 } },
    ],
  },
  {
    name: 'Blood moon',
    halloween: true,
    energy: ['mid', 'wild'],
    effects: [{ type: 'blood-moon', mods: { pulse: beat(0.8) } }],
  },
  {
    name: 'Possessed',
    halloween: true,
    energy: ['wild'],
    effects: [
      { type: 'possessed', mods: { glow: bass(0.4) } },
      { type: 'rgb-glitch', params: { split: 0.006, glitch: 0.1 }, mods: { glitch: beat(0.6) } },
    ],
  },
  {
    name: 'Possessed in red',
    halloween: true,
    energy: ['mid', 'wild'],
    effects: [{ type: 'possessed', params: { hue: 0 }, mods: { glow: beat(0.8) } }],
  },
  {
    name: 'Haunted reel',
    halloween: true,
    energy: ['calm'],
    effects: [{ type: 'old-horror-film' }],
  },
  {
    name: 'Bloody reel',
    halloween: true,
    energy: ['calm', 'mid'],
    effects: [
      { type: 'old-horror-film', params: { sepia: 0 } },
      { type: 'blood-moon', params: { intensity: 0.45, vignette: 0.6 } },
    ],
  },
];
