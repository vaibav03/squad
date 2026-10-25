import { describe, expect, it } from 'vitest';
import { ChatMessageSchema } from './chat';
import {
  CouncilAskBodySchema,
  CouncilResultSchema,
  councilVerdictText,
  type CouncilResult,
} from './council';

const base: CouncilResult = {
  id: 'cn_abcdefghijkl',
  question: 'B or C?',
  status: 'done',
  phase: 'done',
  grounding: 'general',
  notes: ['Not in the course materials, so this is general reasoning.'],
  members: [
    {
      id: 'skeptic',
      name: 'Skeptic',
      stance: 'Looks for what could be wrong',
      status: 'answered',
      text: 'C fails at the boundary.',
      answer: 'B',
      citations: [],
      struck: 0,
    },
  ],
  rankings: [{ member: 'Skeptic', order: ['Teacher', 'Practitioner'] }],
  verdict: {
    chair: 'Chair',
    text: 'Pick B.',
    answer: 'B',
    confidence: 'fairly_sure',
    confidenceNote: 'Two of three agreed.',
    uncertain: false,
    dissent: { member: 'Practitioner', view: 'C is faster.', why: 'It ignores the edge case.' },
    next: 'Try B on the sample input.',
  },
  visibility: 'squad',
  askedBy: 's_ana',
  demo: true,
  startedAt: 1,
};

describe('council contract', () => {
  it('accepts a full result and rejects unknown keys', () => {
    expect(CouncilResultSchema.safeParse(base).success).toBe(true);
    expect(CouncilResultSchema.safeParse({ ...base, score: 0.9 }).success).toBe(false);
    expect(
      CouncilResultSchema.safeParse({ ...base, verdict: { ...base.verdict, confidence: 0.9 } })
        .success,
    ).toBe(false);
  });
  it('validates the ask body', () => {
    expect(CouncilAskBodySchema.safeParse({ question: 'B or C?' }).success).toBe(true);
    expect(
      CouncilAskBodySchema.safeParse({ question: 'B or C?', chatId: 'dm:s_ana' }).success,
    ).toBe(true);
    expect(CouncilAskBodySchema.safeParse({ question: 'x' }).success).toBe(false);
    expect(CouncilAskBodySchema.safeParse({ question: 'a'.repeat(601) }).success).toBe(false);
    expect(CouncilAskBodySchema.safeParse({ question: 'B or C?', extra: 1 }).success).toBe(false);
  });
  it('the chat card variant carries only the run id', () => {
    const msg = {
      id: 'm_1',
      seq: 1,
      chatId: 'group:sq_demo',
      ts: 1,
      sender: { kind: 'persona', id: 'cubbie', name: 'Squad' },
      text: 'The council has spoken.',
      private: false,
      attachments: [],
      citations: [],
      demo: true,
    };
    const card = { type: 'council', runId: 'cn_abcdefghijkl', question: 'B or C?' };
    expect(ChatMessageSchema.safeParse({ ...msg, card }).success).toBe(true);
    expect(ChatMessageSchema.safeParse({ ...msg, card: { ...card, runId: 'bad' } }).success).toBe(
      false,
    );
  });
  it('renders words for confidence, keeps the dissent', () => {
    const t = councilVerdictText(base);
    expect(t).toContain('Fairly sure');
    expect(t).toContain('Dissent (Practitioner)');
    expect(t).not.toMatch(/\d+%|0\.\d/);
    expect(
      councilVerdictText({ ...base, status: 'refused', message: 'Not for the council.' }),
    ).toBe('Not for the council.');
  });
});
