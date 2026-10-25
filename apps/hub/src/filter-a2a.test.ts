import { describe, expect, it } from 'vitest';
import { validateReplay, type A2aMessage, type VillageEvent } from '@squad/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHub } from './app';
import { createCallRegistry } from './calls';
import { filterEvent, filterVillageEvent } from './filter';
import { createDirectory } from './store/directory';
import { createTripStore } from './store/trips';
import type { CouncilRunRegistry, FilterCtx, LoggedEvent, Viewer } from './types';

const RUN = 'cn_k3j9x0a1b2c3';
const TEXT_KEYS = /"(summary|stance|answer|order|citations|dissentRefs|thought|message)":/;
const SECRET_TEXT = 'SENTINEL-therapy-$180';

function ctx(
  runs: Record<string, { askedBy: string; squadId: string; private: boolean }>,
): FilterCtx {
  const directory = createDirectory();
  for (const id of ['s_ana', 's_ben']) directory.upsertStudent({ id, name: id, handle: id });
  directory.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana', 's_ben'] });
  directory.upsertStudent({ id: 's_zed', name: 'z', handle: 'z' });
  directory.upsertSquad({ id: 'sq2', name: 'sq2', members: ['s_zed'] });
  const councils: CouncilRunRegistry = { ownerOf: (id) => runs[id] };
  return { directory, calls: createCallRegistry(), trips: createTripStore(), councils };
}
const v = (studentId: string, squadId = 'sq'): Viewer => ({ studentId, squadId, projector: false });
const msg = (over: Partial<A2aMessage> = {}): A2aMessage => ({
  id: 'am_a1b2c3d4e5f6',
  correlationId: RUN,
  seq: 1,
  from: 'council:ask-skeptic',
  to: 'council:ask-chair',
  kind: 'answer',
  stage: 'opinions',
  summary: SECRET_TEXT,
  stance: SECRET_TEXT,
  answer: SECRET_TEXT,
  order: ['Teacher'],
  citations: [{ file: 'ch6.pdf', page: 3, label: 'ch6.pdf p.3' }],
  dissentRefs: ['am_000000000009'],
  status: 'done',
  mode: 'live',
  source: 'model',
  redaction: 'public',
  ts: 1,
  ...over,
});
const ev = (m: A2aMessage, extra: Partial<VillageEvent> = {}): VillageEvent =>
  ({ t: 'a2a.message', msg: m, ...extra }) as VillageEvent;
const out = (e: VillageEvent, viewer: Viewer, c: FilterCtx) => filterVillageEvent(e, viewer, c);

describe('hub filter: a2a.message and council.stage', () => {
  it('squad run: public envelopes reach every squad member with text', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: false } });
    const r = out(ev(msg()), v('s_ben'), c);
    expect(r).toMatchObject({ t: 'a2a.message', msg: { summary: SECRET_TEXT, mode: 'live' } });
  });

  it('unknown run, other squad, or no registry: default deny', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: false } });
    expect(out(ev(msg({ correlationId: 'cn_aaaaaaaaaaaa' })), v('s_ana'), c)).toBeNull();
    expect(out(ev(msg()), v('s_zed', 'sq2'), c)).toBeNull();
    const none: FilterCtx = { ...c };
    delete none.councils;
    expect(out(ev(msg()), v('s_ana'), none)).toBeNull();
    expect(
      out(
        {
          t: 'council.stage',
          councilId: 'council:ask',
          correlationId: RUN,
          stage: 'done',
          mode: 'live',
        },
        v('s_ana'),
        none,
      ),
    ).toBeNull();
  });

  it('private run: others get a skeleton (arrows/kinds/mode), the asker gets everything', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: true } });
    const skeleton = out(ev(msg(), { thought: SECRET_TEXT, message: SECRET_TEXT }), v('s_ben'), c);
    expect(skeleton).toMatchObject({
      t: 'a2a.message',
      msg: { from: 'council:ask-skeptic', kind: 'answer', mode: 'live' },
    });
    const json = JSON.stringify(skeleton);
    expect(json).not.toContain('SENTINEL');
    expect(json).not.toMatch(TEXT_KEYS);
    const own = out(ev(msg()), v('s_ana'), c);
    expect(JSON.stringify(own)).toContain(SECRET_TEXT);
  });

  it('asker_only envelopes go to the asker only, even in a squad run', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: false } });
    const m = msg({ redaction: 'asker_only', to: 'tool:calendar', kind: 'ask' });
    expect(out(ev(m), v('s_ben'), c)).toBeNull();
    expect(out(ev(m), v('s_ana'), c)).not.toBeNull();
  });

  it('quiz-key envelopes never carry the answer, for anyone', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: false } });
    const m = msg({ from: 'council:quizkey-solver-a', to: 'council:quizkey-verifier' });
    for (const who of ['s_ana', 's_ben']) {
      const r = out(ev(m), v(who), c) as { msg: A2aMessage };
      expect(r.msg).not.toHaveProperty('answer');
      expect(r.msg.from).toBe('council:quizkey-solver-a');
    }
  });

  it('council.stage carries no text and is scoped like the envelopes', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: true } });
    const stage = {
      t: 'council.stage',
      councilId: 'council:ask',
      correlationId: RUN,
      stage: 'critiques',
      mode: 'degraded:timeout',
      thought: SECRET_TEXT,
      message: SECRET_TEXT,
    } as VillageEvent;
    const r = out(stage, v('s_ben'), c);
    expect(r).toEqual({
      t: 'council.stage',
      councilId: 'council:ask',
      correlationId: RUN,
      stage: 'critiques',
      mode: 'degraded:timeout',
    });
    expect(out(stage, v('s_zed', 'sq2'), c)).toBeNull();
  });

  it('withheld values stay hidden and thinking material cannot ride along', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: false } });
    const led: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_ben',
      field: 'budget',
      withheld: 'hidden',
    };
    expect(out(led, v('s_ana'), c)).toEqual(led);
    // the hub's own validation rejects an envelope that smuggles a thought or signature key
    const bad = { t: 'a2a.message', msg: { ...msg(), thoughtSignature: 'SIG-SENTINEL-91c2' } };
    expect(filterVillageEvent(bad as unknown as VillageEvent, v('s_ana'), c)).toBeNull();
  });

  it('wire path (filterEvent) applies the squad scope and the same rules', () => {
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: true } });
    const logged = (payload: VillageEvent, squadId: string | null): LoggedEvent => ({
      seq: 7,
      ts: 0,
      kind: 'village',
      type: payload.t,
      payload,
      squadId,
    });
    expect(filterEvent(logged(ev(msg()), 'sq2'), v('s_ben'), c)).toBeNull();
    const w = filterEvent(logged(ev(msg()), null), v('s_ben'), c);
    expect(w?.event).toBe('a2a.message');
    expect(JSON.stringify(w)).not.toContain('SENTINEL');
  });

  it('every committed council fixture passes the filter for the asker, skeleton fixture for others', () => {
    const file = resolve(__dirname, '../sim/replays/track4-council-a2a.json');
    const rep = validateReplay(readFileSync(file, 'utf8'));
    if (!rep.ok) throw new Error(rep.errors.join(';'));
    const c = ctx({ [RUN]: { askedBy: 's_ana', squadId: 'sq', private: true } });
    for (const e of rep.script.events) {
      if (e.event.t !== 'a2a.message' && e.event.t !== 'council.stage') continue;
      expect(out(e.event, v('s_ana'), c)).not.toBeNull();
      const other = JSON.stringify(out(e.event, v('s_ben'), c));
      expect(other).not.toMatch(TEXT_KEYS);
    }
  });
});

describe('strict hub validation accepts the new kinds', () => {
  it('ingest accepts a2a.message and council.stage, rejects a bad envelope', () => {
    const hub = createHub({
      config: { seed: true, sim: false, authSecret: 'x', logLevel: 'silent' },
    });
    const good = ev(msg());
    expect(hub.deps.ingest.village(good)).toMatchObject({ ok: true });
    expect(
      hub.deps.ingest.village({
        t: 'council.stage',
        councilId: 'council:ask',
        correlationId: RUN,
        stage: 'verdict',
        mode: 'live',
      }),
    ).toMatchObject({ ok: true });
    expect(hub.deps.ingest.village(ev(msg({ summary: 'x'.repeat(281) })))).toMatchObject({
      ok: false,
    });
    expect(hub.deps.ingest.village(ev(msg({ source: 'script', mode: 'live' })))).toMatchObject({
      ok: false,
    });
    expect(
      hub.deps.ingest.village({ t: 'a2a.message', msg: { ...msg(), thought: 'x' } }),
    ).toMatchObject({ ok: false });
    // with no run registry wired yet, nothing reaches a viewer
    const seen = hub.deps.filterCtx.councils?.ownerOf(RUN);
    expect(seen).toBeUndefined();
  });
});
