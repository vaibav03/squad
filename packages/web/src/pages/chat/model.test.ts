import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@squad/core';
import {
  activeMention,
  attachmentLabel,
  citationSpeech,
  linkHost,
  senderSpeech,
  applyMention,
  buildRows,
  citationFor,
  resolveCitations,
  quizAnswerText,
  countUnread,
  dayLabel,
  findCitationMarkers,
  formatBytes,
  formatDuration,
  listTime,
  matchMentions,
  mentionsBot,
  mergeMessages,
  previewLine,
  studentPortraitId,
  textRepeatsCard,
  studentRing,
  uniqueCitations,
  uploadProblem,
  withInlineCites,
  type ThreadItem,
} from './model';

const NOON = new Date(2026, 9, 22, 12, 0, 0).getTime();
const MIN = 60_000;
const msg = (seq: number, who: string, ago: number, text = 't'): ThreadItem => ({
  state: 'sent',
  message: {
    id: `m_${seq}`,
    seq,
    chatId: 'group:sq_demo',
    ts: NOON - ago,
    sender: { kind: 'student', id: who, name: who },
    text,
    private: false,
    attachments: [],
    citations: [],
    demo: false,
  } satisfies ChatMessage,
});

describe('grouping and date separators', () => {
  it('groups consecutive messages from one sender within five minutes', () => {
    const rows = buildRows(
      [msg(1, 's_ben', 4 * MIN), msg(2, 's_ben', 3 * MIN), msg(3, 's_chi', MIN)],
      's_ana',
      NOON,
    );
    const m = rows.filter((r) => r.kind === 'msg');
    expect(m.map((r) => r.kind === 'msg' && [r.head, r.tail])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });
  it('breaks a run after a five minute gap and marks own messages', () => {
    const rows = buildRows([msg(1, 's_ana', 20 * MIN), msg(2, 's_ana', MIN)], 's_ana', NOON);
    const m = rows.filter((r) => r.kind === 'msg');
    expect(m.every((r) => r.kind === 'msg' && r.head && r.own)).toBe(true);
  });
  it('inserts a day separator per calendar day', () => {
    const day = 24 * 60 * MIN;
    const rows = buildRows([msg(1, 's_ben', day + 5 * MIN), msg(2, 's_ben', MIN)], 's_ana', NOON);
    const days = rows.filter((r) => r.kind === 'day');
    expect(days.map((d) => d.kind === 'day' && d.label)).toEqual(['Yesterday', 'Today']);
    // the same sender across midnight starts a new run
    expect(rows.filter((r) => r.kind === 'msg').every((r) => r.kind === 'msg' && r.head)).toBe(
      true,
    );
  });
  it('labels days and list times', () => {
    expect(dayLabel(NOON, NOON)).toBe('Today');
    expect(dayLabel(NOON - 24 * 60 * MIN, NOON)).toBe('Yesterday');
    expect(dayLabel(NOON - 3 * 24 * 60 * MIN, NOON)).toBe('Monday');
    expect(dayLabel(new Date(2025, 2, 4).getTime(), NOON)).toBe('Mar 4, 2025');
    expect(listTime(NOON - 24 * 60 * MIN, NOON)).toBe('Yesterday');
    expect(listTime(NOON - 30 * 24 * 60 * MIN, NOON)).toBe('Sep 22');
  });
  it('history + stream never render the same id or the same send twice', () => {
    const a = msg(5, 's_ben', 2).message;
    const live = { ...a };
    expect(mergeMessages([a], [live, a]).map((m) => m.id)).toEqual([a.id]);
    const first = { ...a, clientId: 'c1' };
    const twin = { ...msg(6, 's_ben', 1).message, clientId: 'c1' };
    expect(mergeMessages([first], [twin]).map((m) => m.seq)).toEqual([5]);
  });
  it('merges by id and keeps seq order', () => {
    const a = msg(2, 's_ben', 2).message;
    const b = msg(1, 's_ben', 3).message;
    expect(mergeMessages([a], [b, { ...a, text: 'edited' }]).map((m) => [m.seq, m.text])).toEqual([
      [1, 't'],
      [2, 'edited'],
    ]);
  });
});

describe('citation markers', () => {
  it('finds the marker spellings the bot produces', () => {
    const t =
      'See [ch6.pdf p.4], also [ch6.pdf p7] and [notes.pdf, p. 12]. Not [a link](x) or [1].';
    expect(findCitationMarkers(t).map((m) => [m.file, m.page])).toEqual([
      ['ch6.pdf', 4],
      ['ch6.pdf', 7],
      ['notes.pdf', 12],
    ]);
  });
  it('reads the hub canonical marker with a long file name and numbers it like its chip', () => {
    const text = 'Spread is the standard deviation [ch6-the-normal-distribution.pdf p.2].';
    const cites = [{ file: 'ch6-the-normal-distribution.pdf', page: 2, label: 'ch6.pdf p.2' }];
    expect(findCitationMarkers(text).map((m) => [m.file, m.page])).toEqual([
      ['ch6-the-normal-distribution.pdf', 2],
    ]);
    expect(withInlineCites(text, cites)).toBe('Spread is the standard deviation [cite: 1].');
    expect(resolveCitations(text, cites)).toEqual(cites);
  });
  it('matches by file stem and page, and derives a label when the hub sent none', () => {
    const cites = [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }];
    expect(citationFor({ file: 'CH6-normal.pdf', page: 4 }, cites)).toBe(cites[0]);
    expect(citationFor({ file: 'ch6.pdf', page: 5 }, cites)).toBeUndefined();
    expect(withInlineCites('a [ch6.pdf p.4] b [ch9.pdf p.9]', cites)).toBe(
      'a [cite: 1] b [cite: 2]',
    );
    expect(resolveCitations('b [ch9.pdf p.9]', [])).toEqual([
      { file: 'ch9.pdf', page: 9, label: 'ch9.pdf p.9' },
    ]);
  });
  it('dedupes citations', () => {
    const c = { file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' };
    expect(uniqueCitations([c, { ...c }, { ...c, page: 5, label: 'ch6.pdf p.5' }])).toHaveLength(2);
  });
});

describe('mentions', () => {
  it('detects an @ being typed at a word start only', () => {
    expect(activeMention('hey @cu', 7)).toEqual({ start: 4, query: 'cu' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('mail me@cu', 10)).toBeNull();
    expect(activeMention('hey @squad what', 16)).toBeNull();
  });
  it('matches by prefix and applies with a trailing space', () => {
    expect(matchMentions('').map((o) => o.id)).toEqual(['cubbie', 'squad']);
    expect(matchMentions('sq').map((o) => o.id)).toEqual(['squad']);
    expect(matchMentions('zz')).toEqual([]);
    const text = 'hey @cu now';
    const mq = activeMention(text, 7)!;
    const r = applyMention(text, 7, mq, matchMentions('cu')[0]!);
    expect(r.text).toBe('hey @squad now');
    expect(r.caret).toBe(11);
  });
  it('sends quiz answers with the mention in a group and bare in a DM', () => {
    expect(quizAnswerText('group:sq_demo', 'B')).toBe('@squad B');
    expect(quizAnswerText('dm:s_ana', 'B')).toBe('B');
  });
  it('knows when the bot is addressed', () => {
    expect(mentionsBot('@Cubbie help')).toBe(true);
    expect(mentionsBot('hello @squad!')).toBe(true);
    expect(mentionsBot('email@squad.org')).toBe(false);
  });
});

describe('small helpers', () => {
  it('formats duration and bytes', () => {
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('checks uploads before sending them', () => {
    expect(uploadProblem({ type: 'image/png', size: 100 })).toBeNull();
    expect(uploadProblem({ type: 'application/pdf', size: 100 })).toMatch(/PNG/);
    expect(uploadProblem({ type: 'image/png', size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
  });
  it('gives each demo student a distinct portrait and ring', () => {
    const ids = ['s_ana', 's_ben', 's_chi', 's_dev'];
    expect(new Set(ids.map(studentPortraitId)).size).toBe(4);
    expect(new Set(ids.map(studentRing)).size).toBe(4);
    expect(studentPortraitId('s_new')).toBe(studentPortraitId('s_new'));
  });
  it('builds list previews and unread counts', () => {
    const base = {
      id: 'group:x' as const,
      kind: 'group' as const,
      title: 't',
      private: false,
      members: [],
    };
    expect(previewLine({ ...base, last: { text: 'hi', ts: 1, senderName: 'Ben', seq: 1 } })).toBe(
      'Ben: hi',
    );
    expect(previewLine({ ...base, id: 'dm:s_ana', kind: 'dm' })).toBe('Only you and Squad');
    expect(
      previewLine({ ...base, last: { text: 'hi', ts: 1, senderName: 'Ana', seq: 1 } }, 'Ana'),
    ).toBe('You: hi');
    const items = [msg(1, 's_ben', 3), msg(2, 's_ana', 2), msg(3, 's_chi', 1)].map(
      (i) => i.message,
    );
    expect(countUnread(items, 1, 's_ana')).toBe(1);
  });
});

describe('card text', () => {
  it('leaves out bubble text that only repeats the card', () => {
    expect(textRepeatsCard('Question 2', { type: 'quiz' })).toBe(true);
    expect(textRepeatsCard('Question 1 of 3: what is it', { type: 'quiz' })).toBe(true);
    expect(textRepeatsCard('Join?', { type: 'confirm', question: 'join?' })).toBe(true);
    expect(textRepeatsCard('Different words', { type: 'confirm', question: 'Join?' })).toBe(false);
  });
});

describe('review fixes: labels, links, merge', () => {
  it('never lets a refetch put a settled confirm card back to pending', () => {
    const confirm = (status: 'pending' | 'answered' | 'timeout') =>
      ({
        ...msg(5, 's_ana', 1).message,
        card: {
          type: 'confirm' as const,
          taskId: 't',
          question: 'q',
          options: ['Yes', 'No'],
          status,
          ...(status === 'answered' ? { answer: 'Yes' } : {}),
        },
      }) satisfies ChatMessage;
    const kept = mergeMessages([confirm('answered')], [confirm('pending')]);
    expect(kept[0]!.card).toMatchObject({ status: 'answered', answer: 'Yes' });
    expect(mergeMessages([confirm('pending')], [confirm('timeout')])[0]!.card).toMatchObject({
      status: 'timeout',
    });
    expect(mergeMessages([confirm('timeout')], [confirm('pending')])[0]!.card).toMatchObject({
      status: 'timeout',
    });
  });
  it('speaks citations, attachments and senders in plain words', () => {
    expect(citationSpeech({ file: 'ch6.pdf', page: 4 })).toBe('Source: chapter 6, page 4');
    expect(citationSpeech({ file: 'ch12-intro.pdf', page: 1 })).toBe('Source: chapter 12, page 1');
    expect(citationSpeech({ file: 'notes.pdf', page: 2 })).toBe('Source: notes, page 2');
    const bot = { kind: 'persona' as const, id: 'cubbie', name: 'Cubbie' };
    const ana = { kind: 'student' as const, id: 's_ana', name: 'Ana' };
    expect(attachmentLabel({ kind: 'audio' }, bot, 's_ana')).toBe('Podcast audio');
    expect(attachmentLabel({ kind: 'image' }, bot, 's_ana')).toBe('Picture from Cubbie');
    expect(attachmentLabel({ kind: 'image' }, ana, 's_ana')).toBe('Image you sent');
    expect(attachmentLabel({ kind: 'image' }, ana, 's_ben')).toBe('Image from Ana');
    expect(senderSpeech(ana, 's_ana')).toBe('You');
    expect(senderSpeech(bot, 's_ana')).toBe('Cubbie, bot');
    expect(senderSpeech(ana, 's_ben')).toBe('Ana');
  });
  it('shows the host when link text hides where the link goes', () => {
    expect(linkHost('click here', 'https://www.example.org/a')).toBe('example.org');
    expect(linkHost('https://good.com/page', 'https://evil.com/x')).toBe('evil.com');
    expect(linkHost('example.org notes', 'https://example.org/n')).toBeNull();
    expect(linkHost('x', 'not a url')).toBeNull();
  });
});
