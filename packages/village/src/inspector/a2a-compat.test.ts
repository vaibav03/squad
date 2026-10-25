import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateReplay } from '@squad/core';
import { createInspectorStore } from './store';
import { eventWords, wordsFor } from './describe';

const file = resolve(__dirname, '../../../../apps/hub/sim/replays/track4-council-a2a.json');
const rep = validateReplay(readFileSync(file, 'utf8'));
if (!rep.ok) throw new Error(rep.errors.join(';'));

describe('additive a2a.message and council.stage (W0 compatibility)', () => {
  it('the inspector store ingests the whole council replay without throwing', () => {
    const store = createInspectorStore({ me: 's_ana' });
    expect(() => {
      for (const e of rep.script.events) store.apply(e.event);
    }).not.toThrow();
    // legacy council events still build the same council voices
    expect(store.ids().length).toBeGreaterThan(0);
  });

  it('unknown future kinds and malformed a2a payloads are ignored, never thrown', () => {
    const store = createInspectorStore();
    for (const raw of [
      { t: 'a2a.message' },
      { t: 'a2a.message', msg: { id: 1 } },
      { t: 'council.stage', stage: 'nope' },
      { t: 'a2a.future', x: 1 },
      null,
      42,
    ])
      expect(() => store.apply(raw)).not.toThrow();
  });

  it('describe gives safe words for the new kinds', () => {
    for (const e of rep.script.events) {
      if (e.event.t !== 'a2a.message' && e.event.t !== 'council.stage') continue;
      expect(() => eventWords(e.event, false)).not.toThrow();
      const w = wordsFor(e.event, false);
      expect(w.now.trim()).not.toBe('');
      expect(w.log).not.toContain(rep.script.cast.me ?? '#');
    }
  });
});
