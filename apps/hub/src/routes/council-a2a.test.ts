import { describe, expect, it } from 'vitest';
import { FakeLlm, type A2aMessage, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCouncilAgents, createCouncilService } from '@squad/brain';
import { createHub } from '../app';
import { filterVillageEvent } from '../filter';
import type { Viewer } from '../types';

const v = (studentId: string, squadId: string): Viewer => ({
  studentId,
  squadId,
  projector: false,
});

/** A real demo-mode Ask council registered as the hub's council service, filtered through the hub's own filterCtx. */
async function setup(chatId: string) {
  const hub = createHub({
    config: { seed: false, sim: false, authSecret: 'x', logLevel: 'silent' },
  });
  const d = hub.deps.directory;
  for (const id of ['s_ana', 's_ben', 's_zed']) d.upsertStudent({ id, name: id, handle: id });
  d.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana', 's_ben'] });
  d.upsertSquad({ id: 'sq2', name: 'sq2', members: ['s_zed'] });
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent): void => void events.push(e);
  hub.deps.council = createCouncilService({
    llm: new FakeLlm(),
    db: openMemoryDb(),
    emit,
    agents: createCouncilAgents({ env: {}, emit }),
    viewer: () => ({
      needles: ['$180', 'therapy'],
      calendarSummary: async () => ({ text: 'therapy $180' }),
    }),
  });
  const h = hub.deps.council.ask({ question: 'Is B or A right?', askedBy: 's_ana', chatId });
  await h.done;
  return { hub, events, id: h.id };
}

const wire = (hub: Awaited<ReturnType<typeof setup>>['hub'], e: VillageEvent, viewer: Viewer) =>
  filterVillageEvent(e, viewer, hub.deps.filterCtx);
const a2a = (events: VillageEvent[]): Extract<VillageEvent, { t: 'a2a.message' }>[] =>
  events.filter((e): e is Extract<VillageEvent, { t: 'a2a.message' }> => e.t === 'a2a.message');

describe('council runtime through the hub filter', () => {
  it('ownerOf resolves via deps.council and the directory', async () => {
    const { hub, id } = await setup('group:sq');
    expect(hub.deps.filterCtx.councils?.ownerOf(id)).toEqual({
      askedBy: 's_ana',
      squadId: 'sq',
      private: false,
    });
    expect(hub.deps.filterCtx.councils?.ownerOf('cn_zzzzzzzzzzzz')).toBeUndefined();
  });

  it('squad run: squadmates see summaries, another squad sees nothing, stage has no text', async () => {
    const { hub, events } = await setup('group:sq');
    const msgs = a2a(events);
    expect(msgs.length).toBeGreaterThan(6);
    let seenText = 0;
    for (const e of msgs) {
      const ben = wire(hub, e, v('s_ben', 'sq')) as { msg: A2aMessage } | null;
      if (e.msg.redaction === 'asker_only') {
        expect(ben).toBeNull();
        expect(wire(hub, e, v('s_ana', 'sq'))).not.toBeNull();
      } else {
        expect(ben?.msg.summary).toBe(e.msg.summary);
        if (ben?.msg.summary) seenText++;
      }
      expect(wire(hub, e, v('s_zed', 'sq2'))).toBeNull();
    }
    expect(seenText).toBeGreaterThan(6);
    const stages = events.filter((e) => e.t === 'council.stage');
    expect(stages.length).toBeGreaterThan(5);
    for (const s of stages) {
      const out = wire(hub, s, v('s_ben', 'sq')) as Record<string, unknown>;
      expect(Object.keys(out).sort()).toEqual(['correlationId', 'councilId', 'mode', 'stage', 't']);
      expect(wire(hub, s, v('s_zed', 'sq2'))).toBeNull();
    }
  });

  it('private run: a squadmate gets skeletons only, the asker gets the text', async () => {
    const { hub, events } = await setup('dm:s_ana');
    const msgs = a2a(events);
    expect(msgs.length).toBeGreaterThan(6);
    for (const e of msgs) {
      const ben = JSON.stringify(wire(hub, e, v('s_ben', 'sq')));
      expect(ben).not.toMatch(/"(summary|stance|answer|order|citations|dissentRefs)":/);
      expect(ben).toContain(e.msg.id);
      if (e.msg.summary)
        expect(JSON.stringify(wire(hub, e, v('s_ana', 'sq')))).toContain('"summary"');
      expect(wire(hub, e, v('s_zed', 'sq2'))).toBeNull();
    }
  });

  it('asker_only tool notes (calendar) reach only the asker', async () => {
    // a live-shaped run is not needed: scripted demo agents never call tools, so exercise the filter on a real
    // envelope shape produced by the runtime for a tool call
    const { hub, id } = await setup('group:sq');
    const note = {
      t: 'a2a.message',
      msg: {
        id: 'am_aaaaaaaaaaaa',
        correlationId: id,
        seq: 99,
        from: 'council:ask-practitioner',
        to: 'tool:calendar',
        kind: 'ask',
        stage: 'opinions',
        summary: 'Looked at free time (aggregates only).',
        status: 'done',
        mode: 'live',
        source: 'model',
        redaction: 'asker_only',
        ts: 1,
      },
    } as unknown as VillageEvent;
    expect(wire(hub, note, v('s_ben', 'sq'))).toBeNull();
    expect(wire(hub, note, v('s_ana', 'sq'))).not.toBeNull();
  });
});
