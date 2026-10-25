import { describe, expect, it } from 'vitest';
import { FakeLlm, sourceUri, type InboundMessage } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createContextStore } from '../../context/store';
import { hashExternalAccount } from '../../context/ids';
import { normalizeItem } from '../../context/normalize';
import { assembleBrain } from '../../experts/brain';
import { makeKit } from '../../experts/testkit';
import { createDoubtSkill } from '../doubt';
import { createCanvasAnswerSkill } from './index';

const T0 = Date.UTC(2026, 10, 2, 12);
const msg = (from: string, text: string, mentionsBot = true): InboundMessage => ({
  chatId: 'group:sq1',
  isGroup: true,
  from,
  text,
  attachments: [],
  mentionsBot,
  ts: T0,
});
const viewerFor = (m: { from: string }) => ({ studentId: m.from, squadIds: ['sq1'] });

function seed(db = openMemoryDb()) {
  const store = createContextStore(db);
  store.upsertConnection({
    id: 'c1',
    ownerId: 's_ana',
    provider: 'canvas',
    mode: 'fixture',
    variant: 'session',
    accountHash: hashExternalAccount('p', 'canvas', 'a'),
    scopes: [],
    status: 'live',
    degraded: false,
    statusNote: null,
    createdAt: T0,
    lastSyncAt: null,
    expiresAt: null,
  });
  const { source, pieces } = normalizeItem(
    { ownerId: 's_ana', connectionId: 'c1', provider: 'canvas', mode: 'fixture', now: T0 },
    {
      externalId: 'a1',
      kind: 'canvas_assignment',
      title: 'Lab Report 2',
      courseId: 'c9',
      url: null,
      modifiedAt: null,
      dueAt: T0 + 86_400_000,
    },
    { text: 'Lab reports lose five points per late day.' },
  );
  store.upsertSource(source, pieces);
  return { store, source, anchor: pieces[0]!.anchor };
}

describe('@cubbie group chat context answers', () => {
  const ctx = {} as never;
  it('answers "what is due" for the asker only; a classmate gets nothing from Ana Canvas', async () => {
    const { store } = seed();
    const skill = createCanvasAnswerSkill(store, { viewerFor, now: () => T0 });
    expect(await skill.match(msg('s_ana', '@cubbie what is due?'), ctx)).toBe(0.95);
    const out = await skill.handle(msg('s_ana', '@cubbie what is due?'), ctx);
    expect(out[0]!.text).toContain('Lab Report 2');
    expect(await skill.match(msg('s_ben', '@cubbie what is due?'), ctx)).toBe(0);
    const ben = await skill.handle(msg('s_ben', '@cubbie what is due?'), ctx);
    expect(JSON.stringify(ben)).not.toContain('Lab Report 2');
    expect(await skill.match(msg('s_ana', 'what is due', false), ctx)).toBe(0);
    expect(await skill.match(msg('s_ana', '@cubbie do my homework due friday'), ctx)).toBe(0);
  });

  it('doubt skill with a viewer cites the asker Canvas source; without one it is unchanged', async () => {
    const k = await makeKit(new FakeLlm());
    const { store, source, anchor } = seed(k.db);
    const llm = new FakeLlm({
      fallback: {
        claims: [
          {
            text: 'Five points are lost per late day.',
            source: sourceUri({ kind: 'canvas_assignment', id: source.id, anchor }),
            quote: 'lose five points per late day',
          },
        ],
      },
    });
    const brain = assembleBrain({ llm, db: k.db, store: k.store, emit: k.emit, context: store });
    const q = '@cubbie how many points do lab reports lose per late day?';
    const withViewer = createDoubtSkill(brain, { viewerFor });
    const ana = await withViewer.handle(msg('s_ana', q), ctx);
    expect(ana[0]!.text).toContain('Lab Report 2');
    const ben = await withViewer.handle(msg('s_ben', q), ctx);
    expect(ben[0]!.text).not.toContain('Lab Report 2');
    const plain = await createDoubtSkill(brain).handle(msg('s_ana', q), ctx);
    expect(plain[0]!.text).not.toContain('Lab Report 2');
  });
});
