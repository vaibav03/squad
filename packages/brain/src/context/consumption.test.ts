import { describe, expect, it } from 'vitest';
import { FakeLlm, sourceUri, type InboundMessage } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCanvasAnswerSkill } from '../skills/canvas';
import { createDoubtSkill } from '../skills/doubt';
import { assembleBrain } from '../experts/brain';
import { makeKit } from '../experts/testkit';
import { FakeTransport, call, idOf, makeHarness, step, submit } from '../agents/test-kit';
import { withContextPorts } from '../agents/course-port';
import { hashExternalAccount } from './ids';
import { normalizeItem } from './normalize';
import { createRetrieveContext } from './retrieve';
import { createContextStore } from './store';
import type { ContextStore } from './store';

const T0 = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;
const ctx = {} as never;
const PRIVATE_TITLE = 'Therapy appointment with Dr Quill';
const GROUP = (from: string, text: string): InboundMessage => ({
  chatId: 'group:sq1',
  isGroup: true,
  from,
  text,
  attachments: [],
  mentionsBot: true,
  ts: T0,
});
const viewerFor = (m: { from: string }) => ({ studentId: m.from, squadIds: ['sq1'] });

function conn(store: ContextStore, id: string, provider: 'canvas' | 'google') {
  store.upsertConnection({
    id,
    ownerId: 's_ana',
    provider,
    mode: 'fixture',
    variant: provider === 'google' ? 'oauth' : 'session',
    accountHash: hashExternalAccount('p', provider, id),
    scopes: [],
    status: 'live',
    degraded: false,
    statusNote: null,
    createdAt: T0,
    lastSyncAt: null,
    expiresAt: null,
  });
}
function put(
  store: ContextStore,
  connectionId: string,
  provider: 'canvas' | 'google',
  item: Parameters<typeof normalizeItem>[1],
  text: string,
) {
  const { source, pieces } = normalizeItem(
    { ownerId: 's_ana', connectionId, provider, mode: 'fixture', now: T0 },
    item,
    { text },
  );
  store.upsertSource(source, pieces);
  return { source, anchor: pieces[0]!.anchor };
}
function seed() {
  const db = openMemoryDb();
  const store = createContextStore(db);
  conn(store, 'cv', 'canvas');
  conn(store, 'gg', 'google');
  const canvas = put(
    store,
    'cv',
    'canvas',
    {
      externalId: 'a1',
      kind: 'canvas_assignment',
      title: 'Homework 4',
      courseId: 'c9',
      url: 'https://canvas.example/a1',
      modifiedAt: null,
      dueAt: T0 + 2 * DAY,
    },
    'Homework 4 covers sampling distributions and the central limit theorem.',
  );
  const classroom = put(
    store,
    'gg',
    'google',
    {
      externalId: 'k1',
      kind: 'classroom_item',
      title: 'Stats Project Proposal',
      courseId: 'g1',
      url: 'https://classroom.google.com/c/k1',
      modifiedAt: null,
      dueAt: T0 + 3 * DAY,
    },
    'Submit a one page proposal for the stats project by the due date.',
  );
  const ev1 = put(
    store,
    'gg',
    'google',
    {
      externalId: 'e1',
      kind: 'gcal_event',
      title: 'Study group',
      courseId: null,
      url: 'https://calendar.google.com/e1',
      modifiedAt: null,
      startsAt: T0 + DAY,
      endsAt: T0 + DAY + 2 * 3_600_000,
    },
    'Study group',
  );
  const ev2 = put(
    store,
    'gg',
    'google',
    {
      externalId: 'e2',
      kind: 'gcal_event',
      title: PRIVATE_TITLE,
      courseId: null,
      url: 'https://calendar.google.com/e2',
      modifiedAt: null,
      startsAt: T0 + 2 * DAY,
      endsAt: T0 + 2 * DAY + 3_600_000,
    },
    PRIVATE_TITLE,
  );
  const doc = put(
    store,
    'gg',
    'google',
    {
      externalId: 'd1',
      kind: 'gdoc',
      title: 'Lecture 7 notes',
      courseId: null,
      url: 'https://docs.google.com/document/d/d1',
      modifiedAt: null,
    },
    'The Zorblatt coefficient measures how quickly a lattice relaxes after perturbation. It is unrelated to any other topic.',
  );
  return { db, store, canvas, classroom, ev1, ev2, doc };
}

describe('deterministic answers cite imported Canvas, Classroom and Calendar sources', () => {
  it('"what is due" lists Canvas and Classroom items with one citation chip each', async () => {
    const { store, canvas, classroom } = seed();
    const skill = createCanvasAnswerSkill(store, { viewerFor, now: () => T0 });
    expect(await skill.match(GROUP('s_ana', '@cubbie what is due?'), ctx)).toBe(0.95);
    const [out] = await skill.handle(GROUP('s_ana', '@cubbie what is due?'), ctx);
    expect(out!.text).toContain('Homework 4');
    expect(out!.text).toContain('Stats Project Proposal [Google Classroom]');
    const kinds = out!.citations!.map((c) => c.source!.kind).sort();
    expect(kinds).toEqual(['canvas_assignment', 'classroom_item']);
    const ids = out!.citations!.map((c) => c.source!.id);
    expect(ids).toEqual(expect.arrayContaining([canvas.source.id, classroom.source.id]));
    const cls = out!.citations!.find((c) => c.source!.kind === 'classroom_item')!;
    expect(cls.source!.url).toBe('https://classroom.google.com/c/k1');
    // the quote is verbatim in the cited chunk, so the source viewer can verify it
    const chunk = store.chunk(classroom.source.id, cls.source!.anchor)!;
    expect(chunk.text).toContain(cls.quote!);
  });

  it('calendar: the group gets aggregates only; the owner gets titles and chips by DM', async () => {
    const { store, ev1, ev2 } = seed();
    const skill = createCanvasAnswerSkill(store, { viewerFor, now: () => T0 });
    const out = await skill.handle(GROUP('s_ana', "@cubbie what's on my calendar this week?"), ctx);
    const group = out.find((o) => o.chatId === 'group:sq1')!;
    const dm = out.find((o) => o.chatId === 'dm:s_ana')!;
    expect(group.text).toMatch(/2 calendar events/);
    expect(group.text).not.toContain('Study group');
    expect(group.text).not.toContain(PRIVATE_TITLE);
    expect(group.citations ?? []).toHaveLength(0);
    expect(dm.text).toContain(PRIVATE_TITLE);
    expect(dm.citations!.map((c) => c.source!.id).sort()).toEqual(
      [ev1.source.id, ev2.source.id].sort(),
    );
    expect(dm.citations!.every((c) => c.source!.kind === 'gcal_event')).toBe(true);
    // a classmate asking gets nothing from Ana's calendar
    expect(await skill.match(GROUP('s_ben', "@cubbie what's on my calendar this week?"), ctx)).toBe(
      0,
    );
  });
});

describe('retrieval path: a topic that exists only in an imported Google Doc', () => {
  const q = '@cubbie what does the Zorblatt coefficient measure?';
  it('a model claim is verified and cited with a source chip', async () => {
    const { db, store, doc } = seed();
    const k = await makeKit(new FakeLlm());
    const llm = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'It measures how quickly a lattice relaxes after perturbation.',
            source: sourceUri({ kind: 'gdoc', id: doc.source.id, anchor: doc.anchor }),
            quote: 'how quickly a lattice relaxes after perturbation',
          },
        ],
      },
    });
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit, context: store });
    void db;
    const [out] = await createDoubtSkill(brain, { viewerFor }).handle(GROUP('s_ana', q), ctx);
    expect(out!.text).toContain('lattice relaxes');
    expect(out!.citations).toHaveLength(1);
    expect(out!.citations![0]!.source).toMatchObject({ kind: 'gdoc', id: doc.source.id });
  });

  it('a forged quote is struck and nothing is cited', async () => {
    const { store, doc } = seed();
    const k = await makeKit(new FakeLlm());
    const llm = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'Invented.',
            source: sourceUri({ kind: 'gdoc', id: doc.source.id, anchor: doc.anchor }),
            quote: 'the coefficient is always exactly seven',
          },
        ],
      },
    });
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit, context: store });
    const [out] = await createDoubtSkill(brain, { viewerFor }).handle(GROUP('s_ana', q), ctx);
    expect(out!.citations ?? []).toHaveLength(0);
  });

  it('demo model: the retrieval-only answer still shows the verified cited chunk', async () => {
    const { store, doc } = seed();
    const k = await makeKit(new FakeLlm());
    const down = new FakeLlm({
      fallback: () => Promise.reject(new Error('demo stand-in')) as never,
    });
    const brain = assembleBrain({
      llm: down,
      db: k.db,
      store: k.store,
      emit: k.emit,
      context: store,
    });
    const [out] = await createDoubtSkill(brain, { viewerFor }).handle(GROUP('s_ana', q), ctx);
    expect(out!.text).toMatch(/Closest match in your connected sources/);
    expect(out!.citations![0]!.source).toMatchObject({ kind: 'gdoc', id: doc.source.id });
    const chunk = store.chunk(doc.source.id, out!.citations![0]!.source!.anchor)!;
    expect(chunk.text).toContain(out!.citations![0]!.quote!);
  });
});

describe("council retrieve tool returns the viewer's imported chunks", () => {
  it('retrieve_course finds the Doc chunk, a verified citation survives, a forged one does not; calendar is never returned', async () => {
    const { store } = seed();
    const ports = withContextPorts(
      undefined,
      createRetrieveContext(store, { studentId: 's_ana', squadIds: ['sq1'] }),
    )!;
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      step(call('retrieve_course', { query: 'Zorblatt coefficient lattice' })),
      submit({
        summary: 'The Zorblatt coefficient is how fast a lattice relaxes.',
        stance: 'grounded in the notes',
        answer: 'relaxation rate',
        citations: [
          {
            file: 'Lecture 7 notes',
            page: 1,
            quote: 'how quickly a lattice relaxes after perturbation',
          },
          { file: 'Lecture 7 notes', page: 1, quote: 'is always exactly seven apples' },
        ],
      }),
    );
    const h = makeHarness({ real, ports });
    const t = await h.run.callAgent(h.specs.alpha!, {
      kind: 'answer',
      stage: 'opinions',
      to: idOf('chair'),
      depth: 1,
      prompt: 'What is the Zorblatt coefficient?',
    });
    expect(t.status).toBe('done');
    const toolInput = JSON.stringify(h.real.inputsOf(idOf('alpha'))[1]);
    expect(toolInput).toContain('Lecture 7 notes');
    expect(toolInput).toContain('lattice relaxes');
    expect(toolInput).not.toContain('Study group');
    expect(toolInput).not.toContain(PRIVATE_TITLE);
    expect(t.citations).toEqual([
      { file: 'Lecture 7 notes', page: 1, label: 'Lecture 7 notes p.1' },
    ]);
    const res = await ports.retrieve('calendar study group appointment');
    expect(JSON.stringify(res)).not.toContain(PRIVATE_TITLE);
  });
});
