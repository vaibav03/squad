import { describe, expect, it } from 'vitest';
import {
  VillageEventSchema,
  type Ctx,
  type InboundMessage,
  type OutboundMessage,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { NOT_IN_MATERIALS, answerSkills, createBrain, loadFixtureCourse } from '../../src';
import { OracleLlm, loadGolden } from '../../evals/oracle';

const golden = loadGolden();

/** End to end over the fixture course: the three answer skills through a router-like pick, events validated. */
describe('brain-answers smoke', () => {
  it('doubt grounded + refusal, behind by DM, hwpolicy hint-only; events valid and answer-free', async () => {
    const db = openMemoryDb();
    const events: VillageEvent[] = [];
    const llm = new OracleLlm(golden, 'honest');
    const brain = createBrain({ llm, db, emit: (e) => void events.push(e) });
    await loadFixtureCourse({ store: brain.store });
    const skills = answerSkills(brain);
    const sent: OutboundMessage[] = [];
    const dms: string[] = [];
    const ctx: Ctx = {
      db,
      llm,
      send: async (o) => void sent.push(o),
      dm: async (_s, t) => void dms.push(t),
      askConfirm: async () => 'timeout',
    };
    const say = async (text: string): Promise<OutboundMessage[]> => {
      const m: InboundMessage = {
        chatId: 'group:t',
        isGroup: true,
        from: 's_ana',
        text,
        attachments: [],
        mentionsBot: true,
        ts: 1,
      };
      const scored = await Promise.all(
        skills.map(async (s) => [s, await s.match(m, ctx)] as const),
      );
      const [best, score] = scored.sort((a, b) => b[1] - a[1])[0]!;
      expect(score).toBeGreaterThan(0);
      return best.handle(m, ctx);
    };

    const g = golden.answerable[3]!;
    const a = await say(`@cubbie ${g.question}`);
    expect(a[0]!.text).toMatch(/\(ch6-the-normal-distribution\.pdf p\.\d+\)$/);

    const r = await say("@cubbie what's on the final exam?");
    expect(r[0]!.text).toBe(NOT_IN_MATERIALS);

    const b = await say('@cubbie am I behind?');
    expect(b[0]!.text).toBe('Sent you a DM.');
    expect(dms[0]).toContain('quiz');

    const h = await say('@cubbie just do HW3 Q2');
    expect(h[0]!.text).toMatch(/Course policy:/);
    expect(h[0]!.text).not.toMatch(/answer is/i);

    for (const e of events) VillageEventSchema.parse(e);
    const blob = JSON.stringify(events);
    expect(blob).not.toContain('Per the book');
    expect(events.some((e) => e.t === 'agent.state' && e.agent === 'dean')).toBe(true);
  });

  it('a call yields captions with valid cites, no call.start/end, and a matching stored transcript', async () => {
    const db = openMemoryDb();
    const events: VillageEvent[] = [];
    const brain = createBrain({
      llm: new OracleLlm(golden, 'honest'),
      db,
      emit: (e) => void events.push(e),
    });
    await loadFixtureCourse({ store: brain.store });
    const g = golden.answerable[0]!;
    const lines = await brain.captions.run({
      callId: 'call-1',
      courseId: 'demo',
      chapter: g.chapter,
      question: g.question,
      student: 's_ana',
    });
    const caps = events.filter((e) => e.t === 'call.caption');
    expect(caps.length).toBe(lines.length);
    expect(caps.every((e) => e.t === 'call.caption' && e.cite !== undefined)).toBe(true);
    expect(events.some((e) => e.t === 'call.start' || e.t === 'call.end')).toBe(false);
    expect(brain.captions.transcript('call-1')).toEqual(lines);
  });
});
