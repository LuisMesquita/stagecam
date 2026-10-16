const HISTORY_SECONDS = 1.2;
const MIN_BEAT_GAP_MS = 280;
const BEAT_DECAY_MS = 160;

/**
 * Kick-drum detector on bass energy: a beat is a jump well above the recent average.
 * Pure (no Web Audio) so it can be unit tested.
 */
export class BeatDetector {
  /** Threshold multiplier over the running average; lower = more beats. */
  threshold = 1.4;
  #history: { at: number; energy: number }[] = [];
  #lastBeat = -Infinity;
  #previous = 0;
  #count = 0;

  get count(): number {
    return this.#count;
  }

  /** Feeds one bass-energy sample (0–1); returns true on a new beat. */
  update(energy: number, now: number): boolean {
    const history = this.#history;
    history.push({ at: now, energy });
    while (history.length && now - history[0].at > HISTORY_SECONDS * 1000) history.shift();
    const average = history.reduce((sum, h) => sum + h.energy, 0) / history.length;
    const rising = energy > this.#previous;
    this.#previous = energy;
    const isBeat =
      rising &&
      energy > 0.08 &&
      energy > average * this.threshold &&
      now - this.#lastBeat > MIN_BEAT_GAP_MS;
    if (isBeat) {
      this.#lastBeat = now;
      this.#count++;
    }
    return isBeat;
  }

  /** 1 right on the beat, decaying to 0. */
  pulse(now: number): number {
    return Math.exp(-(now - this.#lastBeat) / BEAT_DECAY_MS);
  }
}
