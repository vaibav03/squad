import { describe, expect, it } from 'vitest';
import { FakeLlm, parseSourceUri, sourceUri } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { assembleBrain } from '../experts/brain';
import { makeKit } from '../experts/testkit';
import { NOT_IN_MATERIALS } from '../experts/types';
import {
  formatSourceMarker,
  parseMarkers,
  parseSourceMarkers,
  verifyClaims,
  verifySourceClaims,
} from '../citations';
import { chunkPages, chunkText } from './chunk';
import {
  ConnectorAuthError,
  GOOGLE_SCOPES,
  createFakeCanvasConnector,
  createFakeGoogleConnector,
  type CanvasAuth,
  type GoogleAuth,
} from './connectors';
import { hashExternalAccount, sourceIdFor } from './ids';
import { createRetrieveContext } from './retrieve';
import { createContextStore } from './store';
import { syncConnection } from './sync';
import type { ContextConnection } from './types';

const T0 = Date.UTC(2026, 9, 25);
const tokenAuth: CanvasAuth = {
  variant: 'token',
  token: 'tok-1',
  baseUrl: 'https://canvas.fixture.invalid',
};
const feedAuth: CanvasAuth = {
  variant: 'feed',
  feedUrl: 'https://canvas.fixture.invalid/feeds/calendars/user_x.ics',
};

function conn(over: Partial<ContextConnection> = {}): ContextConnection {
  return {
    id: 'conn_1',
    ownerId: 's_ana',
    provider: 'canvas',
    mode: 'fixture',
    variant: 'token',
    accountHash: hashExternalAccount('pepper', 'canvas', 'fixture-canvas-user-1'),
    scopes: ['canvas.api_token.read'],
    status: 'live',
    degraded: false,
    statusNote: null,
    createdAt: T0,
    lastSyncAt: null,
    expiresAt: null,
    ...over,
  };
}
function kit() {
  const db = openMemoryDb();
  const store = createContextStore(db);
  let now = T0;
  return { db, store, deps: { store, now: () => now }, tick: (ms: number) => (now += ms) };
}

describe('chunking', () => {
  it('splits on blank lines, tracks headings as sections, stable anchors', () => {
    const t = '# Intro\n\nFirst paragraph here.\n\n# Details\n\nSecond paragraph with more words.';
    const a = chunkText(t, { prefix: 's' });
    expect(a.map((p) => [p.anchor, p.section])).toEqual([
      ['s1', 'Intro'],
      ['s2', 'Details'],
    ]);
    expect(chunkText(t, { prefix: 's' })).toEqual(a);
  });
  it('hard-wraps long paragraphs and anchors pages', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    expect(chunkText(long, { maxChars: 200 }).every((p) => p.text.length <= 200)).toBe(true);
    const p = chunkPages(
      [
        { page: 3, text: 'Short page.' },
        { page: 4, text: long },
      ],
      { maxChars: 300 },
    );
    expect(p[0]).toMatchObject({ anchor: 'p3', page: 3 });
    expect(p[1]!.anchor).toBe('p4.1');
  });
});

describe('source ids and account hashing', () => {
  it('ids are stable per (owner, provider, external id) and differ across owners', () => {
    expect(sourceIdFor('a', 'canvas', 'x')).toBe(sourceIdFor('a', 'canvas', 'x'));
    expect(sourceIdFor('a', 'canvas', 'x')).not.toBe(sourceIdFor('b', 'canvas', 'x'));
  });
  it('hashes external accounts and never echoes the raw id', () => {
    const h = hashExternalAccount('pep', 'google', 'Me@Example.com');
    expect(h).toBe(hashExternalAccount('pep', 'google', 'me@example.com'));
    expect(h).not.toContain('example');
  });
});

describe('sync pipeline (fake Canvas)', () => {
  it('imports assignments, announcements and file pages; resync is a no-op; edits update; deletions remove', async () => {
    const { store, deps } = kit();
    const canvas = createFakeCanvasConnector();
    store.upsertConnection(conn());
    const r1 = await syncConnection(deps, conn(), canvas, tokenAuth);
    expect(r1).toMatchObject({ outcome: 'ok', failed: 0 });
    expect(r1.added).toBe(5);
    const kinds = store
      .sourcesOfConnection('conn_1')
      .map((s) => s.kind)
      .sort();
    expect(kinds).toEqual([
      'canvas_assignment',
      'canvas_assignment',
      'canvas_assignment',
      'canvas_event',
      'canvas_file',
    ]);
    const again = await syncConnection(deps, conn(), canvas, tokenAuth);
    expect(again).toMatchObject({ added: 0, updated: 0, unchanged: 5 });

    canvas.controls.mutate((d) => {
      const fx = d as {
        assignments: { id: string; description: string }[];
        announcements: unknown[];
      };
      fx.assignments.find((a) => a.id === 'a301')!.description =
        'New instructions: use samples of size 50 and report the standard error.';
      fx.announcements.length = 0;
    });
    const r3 = await syncConnection({ ...deps, full: true }, conn(), canvas, tokenAuth);
    expect(r3).toMatchObject({ updated: 1, removed: 1 });
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    expect(
      store
        .chunks(id)
        .map((c) => c.text)
        .join(' '),
    ).toContain('samples of size 50');
    expect(store.source(id)!.syncVersion).toBe(2);
  });

  it('dedupes identical file content arriving by two routes for the same owner', async () => {
    const { store, deps } = kit();
    const canvas = createFakeCanvasConnector();
    store.upsertConnection(conn());
    await syncConnection(deps, conn(), canvas, tokenAuth);
    const file = store.sourcesOfConnection('conn_1').find((s) => s.kind === 'canvas_file')!;
    const pages = store.chunks(file.id).map((c) => ({ page: c.page!, text: c.text }));
    store.upsertConnection(conn({ id: 'conn_2', provider: 'google' }));
    const out = store.upsertSource(
      {
        ...file,
        id: 'src_other',
        connectionId: 'conn_2',
        kind: 'gdrive_file',
        externalId: 'drive:copy',
      },
      chunkPages(pages),
    );
    expect(out).toBe('duplicate');
  });

  it('feed variant imports events only', async () => {
    const { store, deps } = kit();
    store.upsertConnection(conn({ variant: 'feed' }));
    const r = await syncConnection(
      deps,
      conn({ variant: 'feed' }),
      createFakeCanvasConnector(),
      feedAuth,
    );
    expect(r.added).toBe(3);
    expect(store.sourcesOfConnection('conn_1').every((s) => s.kind === 'canvas_event')).toBe(true);
    const due = store
      .sourcesOfConnection('conn_1')
      .find((s) => s.title.startsWith('Assignment 3'))!;
    expect(due.courseId).toBe('stat-101');
    expect(due.dueAt).toBe(Date.parse('2026-11-02T23:59:00Z'));
  });

  it('expired: sync stops without calling upstream; 401 degrades and keeps data; revoked purges', async () => {
    const { store, deps, tick } = kit();
    const canvas = createFakeCanvasConnector();
    store.upsertConnection(conn());
    await syncConnection(deps, conn(), canvas, tokenAuth);
    const n = store.sourcesOfConnection('conn_1').length;

    canvas.controls.set('unauthorized');
    const deg = await syncConnection(deps, conn(), canvas, tokenAuth);
    expect(deg.outcome).toBe('degraded');
    expect(store.connection('conn_1')).toMatchObject({ status: 'error', degraded: true });
    expect(store.sourcesOfConnection('conn_1')).toHaveLength(n);

    canvas.controls.set('ok');
    store.patchConnection('conn_1', { status: 'live', degraded: false, expiresAt: T0 + 1000 });
    tick(5000);
    const calls = canvas.controls.calls.length;
    expect((await syncConnection(deps, conn(), canvas, tokenAuth)).outcome).toBe('expired');
    expect(store.connection('conn_1')!.status).toBe('expired');
    expect((await syncConnection(deps, conn(), canvas, tokenAuth)).outcome).toBe('expired');
    expect(canvas.controls.calls.length).toBe(calls); // no upstream call while expired

    store.patchConnection('conn_1', { status: 'live', expiresAt: null });
    canvas.controls.set('revoked');
    expect((await syncConnection(deps, conn(), canvas, tokenAuth)).outcome).toBe('revoked');
    expect(store.sourcesOfConnection('conn_1')).toHaveLength(0);
    expect(store.connection('conn_1')!.status).toBe('revoked');
  });
});

describe('Google fake honours minimal scopes', () => {
  const base: GoogleAuth = {
    accessToken: 'a',
    refreshToken: 'r',
    scopes: [GOOGLE_SCOPES.calendar],
  };
  const gconn = conn({ id: 'g1', provider: 'google', variant: 'oauth' });
  it('calendar-only scope sees no Drive or Classroom items; Drive needs the Picker selection', async () => {
    const { store, deps } = kit();
    const google = createFakeGoogleConnector();
    store.upsertConnection(gconn);
    await syncConnection(deps, gconn, google, base);
    expect(store.sourcesOfConnection('g1').map((s) => s.kind)).toEqual([
      'gcal_event',
      'gcal_event',
    ]);

    const withDrive = {
      ...base,
      scopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.drive, GOOGLE_SCOPES.classroomWork],
      pickedFileIds: ['doc-notes-1'],
    };
    await syncConnection(deps, gconn, google, withDrive);
    const kinds = store
      .sourcesOfConnection('g1')
      .map((s) => s.kind)
      .sort();
    expect(kinds).toEqual(['classroom_item', 'gcal_event', 'gcal_event', 'gdoc']);
    await expect(
      google.fetchContent(
        { ...withDrive, pickedFileIds: [] },
        {
          externalId: 'drive:doc-notes-1',
          kind: 'gdoc',
          title: 't',
          courseId: null,
          url: null,
          modifiedAt: null,
        },
      ),
    ).rejects.toBeInstanceOf(ConnectorAuthError);
  });
  it('refresh succeeds with a refresh token, fails without', async () => {
    const google = createFakeGoogleConnector();
    expect((await google.refresh!(base)).accessToken).toMatch(/^fake-access/);
    google.controls.refreshFails = true;
    await expect(google.refresh!(base)).rejects.toThrow();
  });
});

describe('citations across kinds', () => {
  it('source URIs round-trip and markers parse without disturbing [file p.N]', () => {
    const uri = sourceUri({ kind: 'canvas_assignment', id: 'src_abc', anchor: 's2' });
    expect(uri).toBe('source://canvas_assignment/src_abc#s2');
    expect(parseSourceUri(uri)).toEqual({ kind: 'canvas_assignment', id: 'src_abc', anchor: 's2' });
    expect(parseSourceUri('source://nope/x')).toBeNull();
    const text = `see [ch3.pdf p.2] and ${formatSourceMarker({ kind: 'gdoc', id: 'src_1', anchor: 's1' })}`;
    expect(parseMarkers(text)).toHaveLength(1);
    expect(parseSourceMarkers(text)).toMatchObject([{ kind: 'gdoc', id: 'src_1', anchor: 's1' }]);
  });

  it('verifySourceClaims keeps only verbatim quotes inside the cited chunk', async () => {
    const { store, deps } = kit();
    store.upsertConnection(conn());
    await syncConnection(deps, conn(), createFakeCanvasConnector(), tokenAuth);
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    const chunks = store.chunks(id);
    const anchor = chunks.find((c) => /late work/i.test(c.text))!.anchor;
    const ok = {
      text: 'Late work is penalised.',
      source: sourceUri({ kind: 'canvas_assignment', id, anchor }),
      quote: 'Late work loses 10 percent per day',
    };
    const fake = { ...ok, quote: 'Late work is forgiven for everyone' };
    const wrongChunk = {
      ...ok,
      source: sourceUri({ kind: 'canvas_assignment', id, anchor: 'nope' }),
    };
    const otherSource = {
      ...ok,
      source: sourceUri({ kind: 'canvas_assignment', id: 'src_other', anchor }),
    };
    const { verified, struck } = verifySourceClaims([ok, fake, wrongChunk, otherSource], chunks);
    expect(verified).toEqual([ok]);
    expect(struck).toHaveLength(3);
  });

  it('PDF claims still verify exactly as before', () => {
    const pages = [
      {
        courseId: 'c',
        chapter: 'x',
        file: 'a.pdf',
        page: 1,
        text: 'The mean is the average of the values.',
      },
    ];
    const { verified } = verifyClaims(
      [{ text: 't', file: 'a.pdf', page: 1, quote: 'the average of the values' }],
      pages as never,
    );
    expect(verified).toHaveLength(1);
  });
});

describe('visibility and isolation', () => {
  async function seeded() {
    const k = kit();
    k.store.upsertConnection(conn());
    await syncConnection(k.deps, conn(), createFakeCanvasConnector(), tokenAuth);
    return k;
  }
  const ana = { studentId: 's_ana', squadIds: ['sq1'] };
  const ben = { studentId: 's_ben', squadIds: ['sq1'] };

  it('private by default: owner finds it, a squadmate does not', async () => {
    const { store } = await seeded();
    expect(store.search('Central Limit Theorem sample means', ana).length).toBeGreaterThan(0);
    expect(store.search('Central Limit Theorem sample means', ben)).toEqual([]);
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    expect(store.readable(id, ben)).toBeUndefined();
  });

  it('squad opt-in shares to that squad only; unshare returns to private', async () => {
    const { store } = await seeded();
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    store.share(id, 'sq1');
    expect(store.search('sample means Central Limit', ben).some((h) => h.source.id === id)).toBe(
      true,
    );
    expect(
      store.search('sample means Central Limit', { studentId: 's_cy', squadIds: ['sq2'] }),
    ).toEqual([]);
    expect(store.search('sample means Central Limit', { studentId: 's_cy', squadIds: [] })).toEqual(
      [],
    );
    store.unshare(id, 'sq1');
    expect(store.source(id)!.visibility).toBe('private');
    expect(store.search('sample means Central Limit', ben)).toEqual([]);
  });

  it('retrieveContext is viewer-bound and every citation quote is verbatim in its chunk', async () => {
    const { store } = await seeded();
    const hits = await createRetrieveContext(store, ana)(
      'when is the sampling assignment due and how many points',
      'stat-101',
    );
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.citation.source).toMatchObject({ kind: h.kind, id: h.sourceId, anchor: h.anchor });
      expect(
        verifySourceClaims(
          [
            {
              text: 'x',
              source: sourceUri({ kind: h.kind, id: h.sourceId, anchor: h.anchor }),
              quote: h.citation.quote!,
            },
          ],
          store.chunks(h.sourceId),
        ).verified,
      ).toHaveLength(1);
    }
    expect(await createRetrieveContext(store, ben)('sampling assignment due', 'stat-101')).toEqual(
      [],
    );
    expect(
      await createRetrieveContext(store, ana)('Central Limit Theorem sample means', 'bio-110'),
    ).toEqual([]);
  });
});

describe('revocation and expiry', () => {
  it('revokeConnection deletes every derived row and leaves only a tombstone', async () => {
    const { store, deps, db } = kit();
    store.upsertConnection(conn());
    await syncConnection(deps, conn(), createFakeCanvasConnector(), tokenAuth);
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    store.share(id, 'sq1');
    const out = store.revokeConnection('conn_1', 'revoked', T0 + 1);
    expect(out.sources).toBe(5);
    for (const t of ['ctx_sources', 'ctx_chunks', 'ctx_shares'])
      expect((db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe(0);
    expect(store.tombstone(id)).toEqual({ ownerId: 's_ana', reason: 'revoked' });
    expect(store.search('sampling', { studentId: 's_ana', squadIds: ['sq1'] })).toEqual([]);
  });

  it('retention purge removes sources past expiresAt', async () => {
    const { store, db } = kit();
    store.upsertConnection(conn());
    const canvas = createFakeCanvasConnector();
    const items = await canvas.listItems(tokenAuth);
    const { normalizeItem } = await import('./normalize');
    const it0 = items[0]!;
    const n = normalizeItem(
      {
        ownerId: 's_ana',
        connectionId: 'conn_1',
        provider: 'canvas',
        mode: 'fixture',
        now: T0,
        retentionMs: 1000,
      },
      it0,
      await canvas.fetchContent(tokenAuth, it0),
    );
    store.upsertSource(n.source, n.pieces);
    expect(store.purgeExpired(T0 + 500).sources).toBe(0);
    expect(store.purgeExpired(T0 + 1000).sources).toBe(1);
    expect((db.prepare('SELECT COUNT(*) n FROM ctx_chunks').get() as { n: number }).n).toBe(0);
  });
});

describe('Brain.ask with connected sources', () => {
  it('cites a Canvas assignment; refuses to cite a classmate private source; strikes a fabricated quote', async () => {
    const k = await makeKit(new FakeLlm());
    const store = createContextStore(k.db);
    store.upsertConnection(conn());
    await syncConnection({ store, now: () => T0 }, conn(), createFakeCanvasConnector(), tokenAuth);
    const id = sourceIdFor('s_ana', 'canvas', 'assignment:a301');
    const anchor = store.chunks(id).find((c) => /late work/i.test(c.text))!.anchor;
    const llm = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'Late work loses ten percent per day.',
            source: sourceUri({ kind: 'canvas_assignment', id, anchor }),
            quote: 'Late work loses 10 percent per day',
          },
        ],
      },
    });
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit, context: store });
    const a = await brain.ask('stat-101', 'what is the late penalty for assignment 3', {
      viewer: { studentId: 's_ana', squadIds: ['sq1'] },
    });
    expect(a.grounded).toBe(true);
    expect(a.text).toContain('Assignment 3: Sampling Distributions');
    expect(a.citations[0]!.source).toMatchObject({ kind: 'canvas_assignment', id, anchor });

    // classmate: nothing retrievable, no LLM-visible text, plain refusal path
    const calls = llm.calls.length;
    const b = await brain.ask('stat-101', 'what is the late penalty for assignment 3', {
      viewer: { studentId: 's_ben', squadIds: ['sq1'] },
    });
    expect(b.text).toBe(NOT_IN_MATERIALS);
    expect(llm.calls.slice(calls).some((c) => JSON.stringify(c).includes('Late work loses'))).toBe(
      false,
    );

    const bad = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'Late work is free.',
            source: sourceUri({ kind: 'canvas_assignment', id, anchor }),
            quote: 'Late work is free of charge forever',
          },
        ],
      },
    });
    const brain2 = assembleBrain({
      llm: bad,
      db: k.db,
      store: k.store,
      emit: k.emit,
      context: store,
    });
    const c = await brain2.ask('stat-101', 'what is the late penalty for assignment 3', {
      viewer: { studentId: 's_ana', squadIds: ['sq1'] },
    });
    expect(c.grounded).toBe(false);
    expect(c.text).toBe(NOT_IN_MATERIALS);
  });
});
