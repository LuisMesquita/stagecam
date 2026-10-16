import { describe, expect, it } from 'vite-plus/test';
import { BeatDetector } from '../web/src/director/beat.ts';

const FRAME_MS = 1000 / 60;

/** Synthetic kick drum: a short bass burst every `beatMs`, quiet bass in between. */
function kick(beatMs: number, floor = 0.1) {
  return (now: number) => (now % beatMs < 60 ? 0.9 : floor);
}

function run(detector: BeatDetector, signal: (now: number) => number, ms: number): number[] {
  const beats: number[] = [];
  for (let now = 0; now < ms; now += FRAME_MS)
    if (detector.update(signal(now), now)) beats.push(now);
  return beats;
}

describe('BeatDetector', () => {
  it('finds one beat per kick at 120 BPM', () => {
    const beats = run(new BeatDetector(), kick(500), 8000);
    expect(beats.length).toBeGreaterThanOrEqual(15);
    expect(beats.length).toBeLessThanOrEqual(16);
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(500, -2);
  });

  it('still finds beats in loud music with sensitivity turned up (values above 1)', () => {
    const loud = (now: number) => (now % 500 < 60 ? 3.2 : 1.6);
    expect(run(new BeatDetector(), loud, 8000).length).toBeGreaterThanOrEqual(15);
  });

  it('stays quiet on silence and on a steady hum', () => {
    expect(run(new BeatDetector(), () => 0, 4000)).toEqual([]);
    expect(run(new BeatDetector(), () => 0.5, 4000).length).toBeLessThanOrEqual(1);
  });

  it('never fires faster than the minimum gap', () => {
    const beats = run(new BeatDetector(), kick(120), 4000);
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    for (const gap of gaps) expect(gap).toBeGreaterThan(280);
  });

  it('pulse is 1 on the beat and decays', () => {
    const detector = new BeatDetector();
    const [first] = run(detector, kick(500), 600);
    expect(detector.pulse(first)).toBeCloseTo(1);
    expect(detector.pulse(first + 160)).toBeCloseTo(Math.exp(-1));
    expect(detector.pulse(first + 1000)).toBeLessThan(0.01);
    expect(detector.count).toBe(1); // the very first kick has no history to compare against
  });
});
