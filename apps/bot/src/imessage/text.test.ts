import { describe, expect, it } from 'vitest';
import type { CouncilResult } from '@squad/core';
import {
  confirmText,
  councilText,
  quizText,
  renderForIMessage,
  splitMessage,
  stripMarkdown,
} from './text';

const NO_MARKDOWN = /(\*\*|__|^#{1,6}\s|```|\|\s*-{2,}|^\s*\|.*\|\s*$|\]\(https?:)/m;

describe('stripMarkdown', () => {
  it('removes emphasis, headings, fences, quotes and link syntax', () => {
    const out = stripMarkdown(
      '# Title\n**bold** and *it* and `code`\n> quote\n* item\n[the doc](https://x.test/a)\n```\nfenced\n```',
    );
    expect(out).toBe(
      'Title\nbold and it and code\nquote\n- item\nthe doc https://x.test/a\nfenced',
    );
    expect(out).not.toMatch(NO_MARKDOWN);
  });
  it('turns a table into comma lines and drops the rule row', () => {
    const out = stripMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toBe('a, b\n1, 2');
  });
  it('keeps snake_case and 2*3 math intact', () => {
    expect(stripMarkdown('use my_var_name and 2*3*4')).toBe('use my_var_name and 2*3*4');
  });
});

describe('cards as text', () => {
  it('confirm: reply 1 to confirm, 2 to cancel', () => {
    expect(confirmText('Book it?', ['Yes', 'No'])).toBe(
      'Book it?\n1. Yes\n2. No\nReply 1 to confirm, 2 to cancel.',
    );
  });
  it('confirm with other options names each number', () => {
    expect(confirmText('When?', ['Later', 'Now'])).toContain('Reply 1 for Later, 2 for Now.');
    expect(confirmText('Quiz?', ['Yes, quiz me', 'Later', 'Stop reminders'])).toContain(
      'Reply with a number from 1 to 3.',
    );
  });
  it('quiz choices become numbers', () => {
    const t = quizText({
      type: 'quiz',
      index: 1,
      question: 'What is z?',
      input: 'choice',
      choices: [
        { id: 'A', text: 'a score' },
        { id: 'B', text: 'a mean' },
      ],
    });
    expect(t).toBe('Question 2: What is z?\n1) a score\n2) a mean\nReply with a number (1 to 2).');
  });
  it('an answered confirm card is not asked again', () => {
    const out = renderForIMessage({
      text: 'Booked.',
      card: {
        type: 'confirm',
        taskId: 't',
        question: 'Q',
        options: ['Yes', 'No'],
        status: 'answered',
        answer: 'Yes',
      },
    });
    expect(out).toEqual(['Booked.']);
  });

  const council = {
    id: 'cn_abcdefghijkl',
    question: 'q',
    status: 'done',
    phase: 'done',
    grounding: 'course',
    notes: [],
    members: [
      {
        id: 'skeptic',
        name: 'Skeptic',
        stance: 's',
        status: 'answered',
        text: 't',
        answer: 'B',
        citations: [{ file: 'ch6-the-normal-distribution.pdf', page: 4, label: 'ch6.pdf p.4' }],
        struck: 0,
      },
    ],
    rankings: [],
    verdict: {
      chair: 'Chair',
      text: 'long text',
      answer: 'B, the standard error shrinks with n.',
      confidence: 'fairly_sure',
      confidenceNote: 'Two of three agreed.',
      uncertain: false,
      dissent: { member: 'Practitioner', view: 'it depends on the sample', why: 'w' },
      next: 'n',
    },
    visibility: 'squad',
    askedBy: 's_ana',
    demo: false,
    startedAt: 1,
  } as unknown as CouncilResult;

  it('council: verdict, dissent line, top citation and a link', () => {
    const t = councilText(council, 'fallback', 'https://app.test/squad?council=cn_abcdefghijkl');
    expect(t).toBe(
      [
        'Council verdict: B, the standard error shrinks with n.',
        'Fairly sure. Two of three agreed.',
        'Dissent: Practitioner said it depends on the sample',
        'Source: [ch6.pdf p.4]',
        'Full card: https://app.test/squad?council=cn_abcdefghijkl',
      ].join('\n'),
    );
  });
  it('council without a result falls back to the text plus the link', () => {
    expect(councilText(undefined, 'Verdict: B', 'https://x.test/c')).toBe(
      'Verdict: B\nFull card: https://x.test/c',
    );
  });
  it('podcast and explainer become a title plus link', () => {
    const out = renderForIMessage(
      {
        text: '',
        attachments: [
          { kind: 'audio', name: 'Chapter 3 podcast.m4a' },
          { kind: 'image', name: 'explainer-ch3.png' },
        ],
      },
      { link: 'https://app.test/squad?m=m_9' },
    );
    expect(out.join('\n')).toBe(
      'Chapter 3 podcast: https://app.test/squad?m=m_9\n\nexplainer-ch3: https://app.test/squad?m=m_9',
    );
  });
  it('citations missing from the text are listed as [file p.N]', () => {
    const out = renderForIMessage({
      text: 'The mean is the average.',
      citations: [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }],
    });
    expect(out[0]).toBe('The mean is the average.\n\nSources: [ch6.pdf p.4]');
    const inline = renderForIMessage({
      text: 'The mean is the average [ch6.pdf p.4].',
      citations: [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }],
    });
    expect(inline[0]).toBe('The mean is the average [ch6.pdf p.4].');
  });
});

describe('splitMessage', () => {
  it('keeps short text whole', () => {
    expect(splitMessage('hi there')).toEqual(['hi there']);
  });
  it('splits long answers under the limit, in order, losing no words', () => {
    const para = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const text = `${para}\n\n${para}`;
    const parts = splitMessage(text, 300);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(300);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });
  it('hard-splits a single giant token', () => {
    const parts = splitMessage('x'.repeat(2500), 900);
    expect(parts.map((p) => p.length)).toEqual([900, 900, 700]);
  });
  it('caps a very long message at five parts with a pointer to the web', () => {
    const out = renderForIMessage({ text: 'word '.repeat(5000) }, { link: 'https://x.test/m' });
    expect(out).toHaveLength(5);
    expect(out[4]).toContain('Rest: https://x.test/m');
    for (const p of out) expect(p.length).toBeLessThanOrEqual(900);
  });
  it('rendered text never contains markdown syntax', () => {
    const out = renderForIMessage({ text: '## Hi\n**x** | a | b |\n|---|---|\n| 1 | 2 |' });
    expect(out.join('\n')).not.toMatch(NO_MARKDOWN);
  });
});
