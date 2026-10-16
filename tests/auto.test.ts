import { describe, expect, it } from 'vite-plus/test';
import { effects } from '../web/src/engine/registry.ts';
import { SILENCE, newScene } from '../web/src/engine/scene.ts';
import type { Signals } from '../web/src/engine/scene.ts';
import { AutoDirector } from '../web/src/director/auto.ts';
import type { AutoContext } from '../web/src/director/auto.ts';
import { LOOKS } from '../web/src/director/looks.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const context = (overrides: Partial<AutoContext> = {}): AutoContext => ({
  cameras: ['a', 'b', 'c'],
  program: newScene('a'),
  signals: SILENCE,
  audio: true,
  now: 0,
  ...overrides,
});

/** Feeds frames until the music energy settles at `level`. */
function settle(director: AutoDirector, level: number) {
  const signals: Signals = { ...SILENCE, level };
  for (let i = 0; i < 400; i++) director.update(context({ signals }));
}

describe('looks', () => {
  it.each(LOOKS)('$name only uses existing effects and params', (look) => {
    for (const spec of look.effects) {
      const def = effects.get(spec.type);
      expect(def, spec.type).toBeDefined();
      const keys = def!.params.map((p) => p.key);
      for (const key of [...Object.keys(spec.params ?? {}), ...Object.keys(spec.mods ?? {})]) {
        expect(keys, `${spec.type}.${key}`).toContain(key);
      }
    }
  });

  it('has Halloween looks for every energy', () => {
    for (const energy of ['calm', 'mid', 'wild'] as const) {
      expect(LOOKS.some((l) => l.halloween && l.energy.includes(energy))).toBe(true);
    }
  });
});

describe('AutoDirector', () => {
  it('does nothing while disabled', () => {
    const director = new AutoDirector(seeded(1));
    director.queueNow();
    expect(director.update(context())).toBeNull();
  });

  it('cuts after the shot length in beats and moves to another camera', () => {
    const director = new AutoDirector(seeded(2));
    director.enabled = true;
    director.restart(0);
    let decision = null;
    let beats = 0;
    while (!decision && beats < 40) {
      director.onBeat();
      beats++;
      decision = director.update(context());
    }
    expect(decision).not.toBeNull();
    expect(beats).toBe(16);
    expect(decision!.scene.layers[0].sourceId).not.toBe('a');
    expect(decision!.transition).toBe('crossfade');
  });

  it('uses short shots and mostly hard cuts when the music is wild', () => {
    const director = new AutoDirector(seeded(3));
    settle(director, 0.9);
    expect(director.energy).toBe('wild');
    director.enabled = true;
    const shots: number[] = [];
    let cuts = 0;
    director.restart(0);
    for (let beat = 1, last = 0; beat <= 200; beat++) {
      director.onBeat();
      const decision = director.update(context({ signals: { ...SILENCE, level: 0.9 } }));
      if (decision) {
        shots.push(beat - last);
        last = beat;
        if (decision.transition === null) cuts++;
      }
    }
    expect(Math.max(...shots)).toBeLessThanOrEqual(4);
    expect(cuts / shots.length).toBeGreaterThan(0.6);
  });

  it('only picks Halloween looks in Halloween style', () => {
    const director = new AutoDirector(seeded(4));
    director.enabled = true;
    director.style = 'halloween';
    const halloween = new Set(LOOKS.filter((l) => l.halloween).map((l) => l.name));
    for (let i = 0; i < 30; i++) {
      director.queueNow();
      const decision = director.update(context());
      expect(halloween.has(decision!.look)).toBe(true);
    }
  });

  it('runs on time without audio', () => {
    const director = new AutoDirector(seeded(5));
    director.enabled = true;
    director.restart(0);
    expect(director.update(context({ audio: false, now: 2000 }))).toBeNull();
    expect(director.update(context({ audio: false, now: 7100 }))).not.toBeNull();
  });

  it('moves on after 20 s when audio is on but no beats come', () => {
    const director = new AutoDirector(seeded(7));
    director.enabled = true;
    director.restart(0);
    expect(director.update(context({ now: 19_000 }))).toBeNull();
    expect(director.update(context({ now: 20_100 }))).not.toBeNull();
  });

  it('waits when no camera has video', () => {
    const director = new AutoDirector(seeded(6));
    director.enabled = true;
    director.queueNow();
    expect(director.update(context({ cameras: [] }))).toBeNull();
    expect(director.update(context())).not.toBeNull();
  });
});
