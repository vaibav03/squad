// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CouncilStatus } from '@squad/core';
import { EntryGuide, entryTruth } from './EntryGuide';
import { ResultActions, discussInChatHref, planFromVerdictHref } from './ResultActions';
import { statusSentence } from '../lib/state-labels';
import { councilFixtures } from './fixtures';

const st = (key: CouncilStatus['key']['state'], forced = false) =>
  ({ key: { state: key, fix: '' }, demo: { forced } }) as unknown as CouncilStatus;

describe('council entry guide', () => {
  it('says who, what, how long and Gemini or Practice mode', () => {
    render(<EntryGuide status={st('ok')} />);
    for (const n of ['Skeptic', 'Teacher', 'Practitioner', 'Chair'])
      expect(screen.getByText(n)).toBeTruthy();
    expect(screen.getByTestId('cn-guide-time').textContent).toMatch(/seconds/);
    expect(screen.getByTestId('cn-guide-truth').textContent).toBe('Live: answered by Gemini');
  });
  it('maps status to customer wording', () => {
    expect(entryTruth(st('ok', true)).sentence).toBe('Practice mode: example answers, not real AI');
    expect(entryTruth(st('no_key')).sentence).toContain(
      'Not set up yet: add the Gemini key to turn this on',
    );
    expect(entryTruth(st('rate_limited')).state).toBe('partial');
    expect(entryTruth(null).state).toBe('checking');
  });
});

describe('chat notice wording', () => {
  it('never shows env var names', () => {
    expect(statusSentence({ demo: true, llm: 'fake', reason: 'forced_fake' })).toBe(
      'Practice mode: example answers, not real AI',
    );
    expect(statusSentence({ demo: true, llm: 'fake', reason: 'no_key' })).toBe(
      'Not set up yet: add the Gemini key to turn this on',
    );
    expect(statusSentence({ demo: false, llm: 'gemini' })).toBe('Live: answered by Gemini');
  });
});

describe('council result actions', () => {
  it('discuss in chat is the one primary action and carries the run id', () => {
    const r = councilFixtures.done;
    render(<ResultActions result={r} />);
    const chat = screen.getByRole('link', { name: 'Discuss in chat' });
    expect(chat.getAttribute('href')).toBe(discussInChatHref(r.id));
    expect(chat.className).toContain('lv-btn--primary');
    expect(screen.getByRole('link', { name: 'Make a plan from this' }).getAttribute('href')).toBe(
      planFromVerdictHref(r.id),
    );
    expect(planFromVerdictHref('x', 'trip')).toBe('/squad/chat?wizard=trip&seed=x');
    expect(screen.getByRole('button', { name: 'Accept decision' })).toBeTruthy();
    expect(document.querySelectorAll('.lv-btn--primary').length).toBe(1);
  });
});
