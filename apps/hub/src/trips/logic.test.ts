import { plural } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { destinationOptions, pickRange, voteHelp } from './logic';

describe('voteHelp', () => {
  it('one option: confirm wording, no voting numbers', () => {
    const t = voteHelp(1);
    expect(t).toBe('Reply 1 to confirm this option, or tell me what to change.');
    expect(t).not.toMatch(/vote 2/);
  });
  it('N options: a range from 1 to N', () => {
    expect(voteHelp(3)).toBe('Reply with a number from 1 to 3.');
    expect(pickRange(3)).toBe('Pick a number from 1 to 3');
  });
});

describe('destinationOptions', () => {
  it('only the typed destination, priced within the budget', () => {
    const o = destinationOptions('Cabo', 4, 1200);
    expect(o.length).toBeGreaterThanOrEqual(2);
    expect(o.every((x) => x.label.startsWith('Cabo'))).toBe(true);
    expect(o.every((x) => x.perPerson > 0 && x.perPerson <= 1200)).toBe(true);
  });
  it('an unknown destination is still itself, never a substitute', () => {
    const o = destinationOptions('Reykjavik', 3, undefined);
    expect(o.every((x) => x.label.startsWith('Reykjavik'))).toBe(true);
  });
});

describe('plural', () => {
  it('singular for exactly one', () => {
    expect(plural(1, 'option')).toBe('1 option');
    expect(plural(1, 'vote')).toBe('1 vote');
    expect(plural(1, 'member')).toBe('1 member');
    expect(plural(2, 'option')).toBe('2 options');
    expect(plural(0, 'option')).toBe('0 options');
  });
});
