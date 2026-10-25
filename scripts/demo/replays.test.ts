/** CI gate: every committed replay in apps/hub/sim/replays must validate against core. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateReplay } from '@squad/core';
import { replayDir } from './lib/paths';
import path from 'node:path';

const dir = replayDir();
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe('committed replays', () => {
  if (files.length === 0) {
    it.skip(`no replays in ${dir} yet (the demo lead commits track2.json and track3.json); skipped`, () => {});
    return;
  }
  for (const f of files) {
    it(`${f} is a valid core ReplayScript`, () => {
      const v = validateReplay(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(v.ok ? [] : v.errors).toEqual([]);
      if (v.ok) expect(v.script.name).toBe(f.replace(/\.json$/, ''));
    });
  }
});
