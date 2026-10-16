import { effects, transitionList } from '../engine/registry.ts';
import { newEffect, newLayer } from '../engine/scene.ts';
import type { BlendMode, EffectInstance, Scene, Signals } from '../engine/scene.ts';
import { LOOKS } from './looks.ts';
import type { Energy, Look } from './looks.ts';

export type AutoStyle = 'any' | 'halloween';

export interface AutoContext {
  /** Camera ids that currently have video. */
  cameras: string[];
  program: Scene;
  signals: Signals;
  /** True when an audio input is running (beats drive the pace). */
  audio: boolean;
  now: number;
}

export interface AutoDecision {
  scene: Scene;
  /** Transition id, or null for a hard cut. */
  transition: string | null;
  seconds: number;
  look: string;
}

/** With audio but no beats (between songs, a quiet room), still move on after this long. */
const MAX_SHOT_MS = 20_000;
const SHOT_BEATS: Record<Energy, number[]> = { wild: [2, 4, 4], mid: [8], calm: [16] };
const SUPERIMPOSE_BLENDS: BlendMode[] = ['screen', 'difference', 'lighten'];

/** Builds a new shot every few beats (or seconds without audio), paced by the music's energy. */
export class AutoDirector {
  enabled = false;
  style: AutoStyle = 'any';
  #random: () => number;
  #energy = 0;
  #beats = 0;
  #shotStart = 0;
  #shotBeats = 8;
  #shotMs = 5000;
  #lastLook = '';

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  get energy(): Energy {
    return this.#energy > 0.5 ? 'wild' : this.#energy > 0.22 ? 'mid' : 'calm';
  }

  /** Beats or milliseconds left in the current shot, for the status line. */
  remaining(ctx: Pick<AutoContext, 'audio' | 'now'>): string {
    if (ctx.audio) return `${Math.max(0, this.#shotBeats - this.#beats)} beats`;
    return `${Math.max(0, Math.ceil((this.#shotMs - (ctx.now - this.#shotStart)) / 1000))} s`;
  }

  /** Makes the next update() build a shot right away. */
  queueNow(): void {
    this.#beats = Infinity;
    this.#shotStart = -Infinity;
  }

  onBeat(): void {
    this.#beats++;
  }

  /** Starts a fresh shot length, e.g. after the director switched by hand. */
  restart(now: number): void {
    this.#shotStart = now;
    this.#beats = 0;
    this.#shotBeats = this.#pick(SHOT_BEATS[this.energy]);
    this.#shotMs = 3000 + this.#random() * 4000;
  }

  update(ctx: AutoContext): AutoDecision | null {
    this.#energy += (ctx.signals.level - this.#energy) * 0.02;
    if (!this.enabled || ctx.cameras.length === 0) return null;
    const elapsed = ctx.now - this.#shotStart;
    const due = ctx.audio
      ? this.#beats >= this.#shotBeats || elapsed >= MAX_SHOT_MS
      : elapsed >= this.#shotMs;
    if (!due) return null;
    const decision = this.#compose(ctx);
    this.restart(ctx.now);
    return decision;
  }

  #compose(ctx: AutoContext): AutoDecision {
    const energy = this.energy;
    const current = ctx.program.layers[0]?.sourceId;
    const others = ctx.cameras.filter((id) => id !== current);
    const camera = this.#pick(others.length ? others : ctx.cameras);

    const pool = LOOKS.filter(
      (look) => (this.style === 'any' || look.halloween) && look.energy.includes(energy),
    );
    const fresh = pool.filter((look) => look.name !== this.#lastLook);
    const look = this.#pick(fresh.length ? fresh : pool.length ? pool : LOOKS);
    this.#lastLook = look.name;

    const base = newLayer(camera);
    base.effects = instantiate(look);
    const layers = [base];
    const second = ctx.cameras.filter((id) => id !== camera);
    if (energy !== 'calm' && second.length && this.#random() < 0.25) {
      const overlay = newLayer(this.#pick(second), this.#pick(SUPERIMPOSE_BLENDS));
      overlay.opacity = 0.5 + this.#random() * 0.2;
      layers.push(overlay);
    }

    const roll = this.#random();
    let transition: string | null = null;
    let seconds = 0;
    if (energy === 'calm') {
      transition = 'crossfade';
      seconds = 1.2 + this.#random() * 0.8;
    } else if (energy === 'mid' ? roll < 0.5 : roll < 0.2) {
      transition = energy === 'wild' ? 'glitch' : this.#pick(transitionList.map((t) => t.id));
      seconds = 0.4 + this.#random() * 0.4;
    }
    return { scene: { layers }, transition, seconds, look: look.name };
  }

  #pick<T>(list: T[]): T {
    return list[Math.floor(this.#random() * list.length) % list.length];
  }
}

function instantiate(look: Look): EffectInstance[] {
  const list: EffectInstance[] = [];
  for (const spec of look.effects) {
    const def = effects.get(spec.type);
    if (!def) continue;
    const instance = newEffect(def);
    Object.assign(instance.params, spec.params);
    if (spec.mods) instance.mods = structuredClone(spec.mods);
    list.push(instance);
  }
  return list;
}
