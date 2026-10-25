import { describe, expect, it } from 'vitest';
import {
  AGENT_ALIASES,
  MAX_MENTION_FANOUT,
  isNearMiss,
  mentionHelpText,
  parseMentions,
  resolveAlias,
  suggestAliases,
} from './mentions';

const ids = (t: string) => parseMentions(t).mentions.map((m) => m.agent.id);
const unknown = (t: string) => parseMentions(t).unknownMention.map((u) => u.word);

describe('alias table', () => {
  it('lists Cubbie first and every id/alias once', () => {
    expect(AGENT_ALIASES[0]!.id).toBe('cubbie');
    expect(AGENT_ALIASES[0]!.aliases).toEqual(['cubbie', 'cubbi', 'squad']);
    const all = AGENT_ALIASES.flatMap((a) => a.aliases);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(AGENT_ALIASES.map((a) => a.id)).size).toBe(AGENT_ALIASES.length);
    for (const a of AGENT_ALIASES) {
      expect(a.name).toBeTruthy();
      expect(a.description).toBeTruthy();
      if (a.kind === 'persona') expect(a.personaId).toBeTruthy();
      if (a.kind === 'skill' || a.kind === 'council') expect(a.skill).toBeTruthy();
    }
  });
  it.each([
    ['cubbie', 'cubbie'], ['CUBBI', 'cubbie'], ['squad', 'cubbie'], ['teacher', 'tutor'], ['Tutor', 'tutor'],
    ['skeptic', 'skeptic'], ['planner', 'planner'], ['examiner', 'examiner'], ['chair', 'chair'],
    ['council', 'council'], ['advisor', 'advisor'], ['chill', 'chill'], ['grind', 'grind'],
    ['chairman', 'chairman'], ['quiz', 'quiz'], ['feynman', 'feynman'], ['stepdiff', 'stepdiff'], ['podcast', 'podcast'],
  ])('@%s resolves to %s', (w, id) => expect(resolveAlias(w)?.id).toBe(id));
});

describe('parseMentions: positives', () => {
  it.each([
    '@cubbie hi', '@Cubbie hi', '@CUBBIE hi', '@cubbi hi', '@Cubbi hi', '@CuBbI hi',
    'hey @cubbie what is a z-score?', 'thanks @cubbie!', 'so @cubbi, can you explain',
    '@cubbi: quiz me', '@cubbi? hello', 'what is this @cubbie', '(@cubbie)', 'ok.@cubbie',
    '@cubbie\nnext line', '@cubbie.', 'wait @cubbi...',
  ])('mention in %j', (t) => expect(ids(t)).toEqual(['cubbie']));
  it('several mentions keep order and are distinct per agent', () => {
    expect(ids('@tutor then @skeptic then @tutor again and @squad')).toEqual(['tutor', 'skeptic', 'cubbie']);
    expect(ids('@cubbie @cubbi @Cubbie')).toEqual(['cubbie']);
    expect(MAX_MENTION_FANOUT).toBe(3);
  });
  it('rest strips mentions and tidies', () => {
    expect(parseMentions('hey @cubbie what is a z-score?').rest).toBe('hey what is a z-score?');
    expect(parseMentions('@cubbi').rest).toBe('');
    expect(parseMentions('@tutor, explain z').rest).toBe('explain z');
    expect(parseMentions('thanks @cubbie!').rest).toBe('thanks!');
  });
  it('records the alias as typed (lowercased) and the span', () => {
    const m = parseMentions('yo @Cubbi')!.mentions[0]!;
    expect(m.alias).toBe('cubbi');
    expect('yo @Cubbi'.slice(m.start, m.end)).toBe('@Cubbi');
  });
});

describe('parseMentions: not mentions', () => {
  it.each([
    '', '   ', 'lol', 'cubbie', 'cubbie is slow', '@cubbies', '@cubb', '@cub', '@squadron', '@cubbie-bot', '@cubbi.fan',
    'me@cubbi.com', 'me@cubbie.com', 'a.b@squad.io', 'user@host', 'x@cubbi', 'a+b@cubbie', '@@cubbie', 'path/@cubbie',
    'use `@cubbie` here', 'use ```\n@cubbie\n``` here', 'he said "@cubbie hi"', 'she said “@tutor hi”',
    '> @cubbie quoted', 'https://x.com/@cubbie', 'www.x.com/@cubbi', '[@cubbie](https://x.com)', '@cubbié',
  ])('%j', (t) => {
    expect(ids(t)).toEqual([]);
    expect(unknown(t)).toEqual([]);
  });
  it('an unclosed quote or backtick does not hide a mention', () => {
    expect(ids('he said "hello @cubbie')).toEqual(['cubbie']);
    expect(ids('a ` b @cubbie')).toEqual(['cubbie']);
  });
  it('a mention after a closed quote still counts', () => {
    expect(ids('"quoted @tutor" but @cubbie please')).toEqual(['cubbie']);
  });
  it('non-strings are safe', () => {
    expect(parseMentions(undefined as unknown as string).mentions).toEqual([]);
    expect(parseMentions(42 as unknown as string).rest).toBe('');
  });
});

describe('parseMentions: unknown tags', () => {
  it('reports unknown @word, distinct and in order', () => {
    expect(unknown('@nobodyhome help')).toEqual(['nobodyhome']);
    expect(unknown('hi @bob and @Alice and @bob')).toEqual(['bob', 'Alice']);
  });
  it('a homoglyph lookalike is unknown, never Cubbie', () => {
    expect(ids('@\u0441ubbie hi')).toEqual([]);
    expect(unknown('@\u0441ubbie hi')).toHaveLength(1);
  });
  it('known and unknown together', () => {
    const p = parseMentions('@tutor and @xyz');
    expect(p.mentions.map((m) => m.agent.id)).toEqual(['tutor']);
    expect(p.unknownMention.map((u) => u.word)).toEqual(['xyz']);
  });
  it('near-misses are not unknown', () => {
    expect(isNearMiss('cubbies')).toBe(true);
    expect(isNearMiss('cub')).toBe(true);
    expect(isNearMiss('nobody')).toBe(false);
    expect(unknown('@cubbies and @cub')).toEqual([]);
  });
  it('help text lists the agents and caps the echoed word', () => {
    const h = mentionHelpText('x'.repeat(60));
    expect(h).toContain('@cubbie');
    expect(h).toContain('@tutor');
    expect(h).toContain('@quiz');
    expect(h).not.toContain('x'.repeat(30));
  });
});

describe('suggestAliases', () => {
  it('lists Cubbie first and matches @cub and @cubbi', () => {
    expect(suggestAliases('')[0]!.alias).toBe('cubbie');
    expect(suggestAliases('cub').map((s) => s.alias)).toEqual(['cubbie', 'cubbi']);
    expect(suggestAliases('cubbi').map((s) => s.alias)).toEqual(['cubbie', 'cubbi'].filter((a) => a.startsWith('cubbi')));
    expect(suggestAliases('TU')[0]!.agent.id).toBe('tutor');
    expect(suggestAliases('zzz')).toEqual([]);
  });
});
