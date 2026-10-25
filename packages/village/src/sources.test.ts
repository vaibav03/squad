import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { VILLAGE_SOURCES_ENTRY } from './sources';

describe('@squad/village/sources', () => {
  it('loads and stays Phaser-free', () => {
    expect(VILLAGE_SOURCES_ENTRY).toBe(true);
    expect(readFileSync(new URL('./sources.ts', import.meta.url), 'utf8')).not.toMatch(
      /from 'phaser'/,
    );
  });
});
