// Every bot reply carries provenance (docs/provenance.md): verified citation chips, or an explicit label. A reply to a
// course question with neither is a bug: this test fails on it. Demo mode (scripted model over the sample course).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, PROVENANCE_LABELS, type ChatMessage } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import type { RunningHub } from '../../src/server';
import { boot, login, post } from '../helpers';

let hub: RunningHub;
let url: string;
let ana: string;

const history = (chatId: string): ChatMessage[] =>
  hub.deps.chat.store.since(0, [chatId]).map((m) => ChatMessageSchema.parse(m));
const botMsgs = (chatId: string) => history(chatId).filter((m) => m.sender.kind === 'persona');

/** Send as Ana and wait until the bot has been quiet for a moment after at least one reply. */
async function ask(chatId: string, text: string, via?: string): Promise<ChatMessage[]> {
  const before = history(chatId).length;
  const r = await post(url, '/v1/chat/send', { chatId, text }, ana);
  expect(r.status).toBe(202);
  void via;
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - t0 < 15_000) {
    await new Promise((res) => setTimeout(res, 250));
    const n = history(chatId).length - before;
    if (n >= 2 && n === last) {
      if (++stable >= 2) break;
    } else stable = 0;
    last = n;
  }
  return history(chatId).slice(before).filter((m) => m.sender.kind === 'persona');
}

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  await attachChatEngine(hub, { real: null, env: {}, envFile: false, noProbe: true });
  ana = await login(url, 's_ana');
}, 60_000);
afterAll(async () => {
  await hub.stop();
});

/** The invariant: provenance exists, and it is either chips or an explicit label. */
function expectProvenance(m: ChatMessage) {
  expect(m.provenance, m.text.slice(0, 60)).toBeDefined();
  const p = m.provenance!;
  if (m.citations.length > 0) {
    expect(p.kind).toBe('grounded');
    expect(p.sources).toBe(m.citations.length);
  } else {
    expect(p.kind).not.toBe('grounded');
    expect(p.label.length).toBeGreaterThan(5);
  }
  expect(['live', 'degraded', 'demo']).toContain(p.mode);
}

describe('every reply type shows chips or an explicit label', () => {
  it('a course doubt is grounded with a verified chip, mode Demo, via web', async () => {
    const out = await ask('dm:s_ana', 'what is the empirical rule in the normal distribution?');
    const m = out.at(-1)!;
    expectProvenance(m);
    expect(m.provenance).toMatchObject({ kind: 'grounded', mode: 'demo', via: 'web' });
    expect(m.citations[0]!.file).toMatch(/\.pdf$/);
    // the chip opens a real page: the hub can excerpt it
    const r = await fetch(
      `${url}/v1/chat/citation?file=${encodeURIComponent(m.citations[0]!.file)}&page=${m.citations[0]!.page}`,
      { headers: { authorization: `Bearer ${ana}` } },
    );
    expect(r.status).toBe(200);
  });

  it('an off-course question gets the refusal and an explicit label', async () => {
    const m = (await ask('dm:s_ana', 'what is the airspeed of a swallow?')).at(-1)!;
    expectProvenance(m);
    expect(m.text).toMatch(/not in the materials/i);
    expect(m.provenance!.label).toBe(PROVENANCE_LABELS.demo);
  });

  it('quiz question and its feedback', async () => {
    const q = (await ask('dm:s_ana', 'quiz me on ch6')).at(-1)!;
    expect(q.card?.type).toBe('quiz');
    expectProvenance(q);
    expect(q.provenance!.label).toMatch(/course material/);
    const fb = await ask('dm:s_ana', 'A');
    for (const m of fb) expectProvenance(m);
  });

  it('homework policy, behind, catch-me-up, study-plan pointer', async () => {
    for (const text of [
      'can you do my homework 3 for me',
      'am I behind?',
      'catch me up',
      'study plan',
    ]) {
      const out = await ask('dm:s_ana', text);
      expect(out.length, text).toBeGreaterThan(0);
      for (const m of out) expectProvenance(m);
    }
  });

  it('group: council verdict, plan card and progress line all carry provenance', async () => {
    const day = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    const out = await ask('group:sq_demo', `@cubbie study plan for the exam on ${day}`);
    expect(out.length).toBeGreaterThan(1);
    for (const m of out) expectProvenance(m);
    const card = out.find((m) => m.card?.type === 'plan')!;
    expect(card.provenance!.kind === 'sample' || card.provenance!.kind === 'grounded').toBe(true);
    const council = await ask('group:sq_demo', '@cubbie council should I study ch6 or ch7 first?');
    for (const m of council) expectProvenance(m);
  }, 60_000);

  it('every bot message stored so far satisfies the invariant (no grounded reply without chips)', () => {
    const all = [...botMsgs('dm:s_ana'), ...botMsgs('group:sq_demo')];
    expect(all.length).toBeGreaterThan(8);
    for (const m of all) expectProvenance(m);
  });
});

describe('the composer downgrades what it cannot verify', () => {
  it('a bot post citing a page that does not exist is ungrounded and its chip is dropped', () => {
    const m = hub.deps.chat.postBot({
      chatId: 'group:sq_demo',
      personaId: 'cubbie',
      personaName: 'Squad',
      text: 'The answer is 42 [ghost-chapter.pdf p.9].',
      citations: [{ file: 'ghost-chapter.pdf', page: 9, label: 'ghost.pdf p.9' }],
      attachments: [],
    })!;
    expect(m.citations).toEqual([]);
    expect(m.provenance).toMatchObject({
      kind: 'ungrounded',
      label: PROVENANCE_LABELS.ungrounded,
      sources: 0,
    });
  });

  it('a post with a skill-provided label keeps it', () => {
    const m = hub.deps.chat.postBot({
      chatId: 'group:sq_demo',
      personaId: 'cubbie',
      personaName: 'Squad',
      text: 'Trip card',
      citations: [],
      attachments: [],
      provenance: { label: 'No course sources used: trip planning' },
    })!;
    expect(m.provenance!.label).toBe('No course sources used: trip planning');
  });
});

describe('iMessage plain-text equivalent', () => {
  it('a reply without chips renders its label as one plain line', async () => {
    const { renderForIMessage } = await import('@squad/bot');
    const parts = renderForIMessage({
      text: 'Not in the materials. Ask the TA.',
      provenance: { kind: 'no_sources', label: 'No course sources used', sources: 0, mode: 'live' },
    });
    expect(parts.join('\n')).toMatch(/\(No course sources used\)$/);
    const grounded = renderForIMessage({
      text: 'It is 68% (ch6.pdf p.4).',
      citations: [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }],
      provenance: { kind: 'grounded', label: '1 source', sources: 1, mode: 'live' },
    });
    expect(grounded.join('\n')).toContain('ch6.pdf p.4');
  });
});
