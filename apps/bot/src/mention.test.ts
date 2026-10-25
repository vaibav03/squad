import { describe, expect, it } from 'vitest';
import { detectMention } from './mention';

describe('detectMention', () => {
  it.each([
    '@cubbie hi',
    '@squad what is a z-score?',
    'thoughts @Squad?',
    '@Cubbie what is a mitochondria',
    'what do you think @CUBBIE?',
    'cubbie, quiz me',
    'Cubbie: help',
    'hey cubbie what time is the exam',
    'Hi Cubbie',
    '  yo cubbie ',
    'ok cubbie!',
  ])('mentions: %s', (t) => expect(detectMention(t, true)).toBe(true));

  it.each([
    'lol',
    '',
    'cubbies are cute',
    'scrubbie',
    'I told cubbie yesterday',
    'email me@cubbie.com',
    'x@cubbiefan',
    'email me@squad.com',
    '@squadron go',
    'the cubbie bot is slow',
  ])('no mention: %j', (t) => expect(detectMention(t, true)).toBe(false));

  it('every DM counts as a mention', () => {
    expect(detectMention('anything', false)).toBe(true);
    expect(detectMention('', false)).toBe(true);
  });
});
