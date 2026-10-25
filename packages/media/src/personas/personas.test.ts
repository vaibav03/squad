import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPERT_IDS,
  expertForChapter,
  getPersona,
  listPersonas,
  personasByRole,
  upsertPersona,
} from './index.js';
import { repoRoot } from '../sprites/index.js';

describe('persona registry', () => {
  it('has the full roster with unique ids', () => {
    const ids = listPersonas().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['cubbie', 'examiner', 'dean', 'rival', 'chairman', 'feynman', ...EXPERT_IDS])
      expect(ids).toContain(id);
    expect(personasByRole('student')).toHaveLength(6);
    expect(personasByRole('council').map((p) => p.id)).toEqual([
      'council-chill',
      'council-grind',
      'council-advisor',
      'chairman',
    ]);
  });

  it('every sprite sheet, portrait and fluent portrait exists on disk', () => {
    for (const p of listPersonas()) {
      for (const f of [p.spriteSheet, p.portrait, p.fluentPortrait]) {
        if (f) expect(existsSync(join(repoRoot(), f)), `${p.id}: missing ${f}`).toBe(true);
      }
    }
  });

  it('voice descriptions are distinct per persona', () => {
    const v = listPersonas().map((p) => p.voiceDescription);
    expect(new Set(v).size).toBe(v.length);
  });

  it('getPersona throws on unknown ids; upsert overlays', () => {
    expect(() => getPersona('nope')).toThrow(/unknown persona/);
    const c = getPersona('cubbie');
    upsertPersona({ ...c, voiceId: 'v_123' });
    expect(getPersona('cubbie').voiceId).toBe('v_123');
    upsertPersona(c);
  });

  it('expertForChapter is stable and spreads across looks', () => {
    expect(expertForChapter('5').id).toBe(expertForChapter('5').id);
    expect(expertForChapter('5').nameOverride).toBe('Ch5 expert');
    const seen = new Set(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map(
        (c) => expertForChapter(c).id,
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});
