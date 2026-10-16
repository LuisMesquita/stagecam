import { describe, expect, it } from 'vite-plus/test';
import { effectList, transitionList } from '../web/src/engine/registry.ts';

describe('effect registry', () => {
  it('auto-registers every effect and transition file', () => {
    expect(effectList.length).toBeGreaterThanOrEqual(8);
    expect(transitionList.map((t) => t.id).sort()).toEqual(['crossfade', 'glitch', 'wipe']);
  });

  it('has unique ids', () => {
    const ids = [...effectList, ...transitionList].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(effectList)('$name has valid params and entry point', (def) => {
    for (const p of def.params) {
      expect(p.key).toMatch(/^[a-zA-Z]\w*$/);
      expect(p.min).toBeLessThan(p.max);
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
    if (def.kind === 'shader') expect(def.glsl).toMatch(/vec4\s+effect\s*\(\s*vec2/);
  });

  it.each(transitionList)('$name defines transition()', (def) => {
    expect(def.glsl).toMatch(/vec4\s+transition\s*\(\s*vec2/);
  });
});
