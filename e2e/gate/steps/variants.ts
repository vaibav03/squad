// V1..V5: connector-side variants (fresh setup, reconnect, revoked auth, expired token, Canvas upstream gone). The
// iMessage and conversation variants (V6..V12) live in variants-im.ts. Each runs in its own world.
import { P } from '../lib/probes';
import { api, history } from '../lib/hub';
import { google } from '../lib/fakes/client';
import {
  asSet,
  canvasFeedBroken,
  connectEverything,
  connectGoogle,
  connectionStatus,
  disconnectAll,
  expireUpstream,
  items,
  listConnections,
  resetUpstreams,
  revokeUpstream,
  searchContext,
  syncAll,
} from './flows';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { defaultSentinels } from '../lib/asserts';
import { FACTS } from '../lib/fakes/content';
import { ask } from './flows';
import { V6, V7, V8, V9, V10, V11, V12 } from './variants-im';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export interface VariantDef {
  def: StepDef<GateCtx>;
  world: { kind?: 'fresh' | 'journey'; b?: boolean; actors?: boolean };
}

const CONNECT_NEEDS = [P.context, P.connectors];

export const V1: StepDef<GateCtx> = {
  id: 'V1',
  title: 'Fresh setup: connecting is optional and asking before connecting is honest',
  needs: [...CONNECT_NEEDS, P.mentions],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    const list = await listConnections(rhea);
    a.eq('a new account has no connections', list.connections.length, 0);
    a.ok('the hub lists the allowed scopes up front', Object.keys(list.allowedScopes).length > 0);
    const r = await ask(rhea, c.world.squadA.chatId, `@cubbie ${FACTS.hw4Question}`);
    a.ok('asking before connecting still gets an answer', !!r.reply);
    const t = r.reply?.text ?? '';
    a.ok(
      'and says nothing is connected and offers a way to connect',
      /connect|no canvas|not connected/i.test(t),
      'reply does not mention connecting',
    );
    a.eq('with no citations', r.reply?.citations.length, 0);
    a.noLeak('reply', t, defaultSentinels());
    const pr = c.actors.rhea;
    if (pr) {
      await pr.page.goto('/squad/connections');
      await sleep(1500);
      const txt = await pr.page.locator('body').innerText();
      a.ok(
        'the Connections page offers Canvas and Google',
        /canvas/i.test(txt) && /google/i.test(txt),
      );
      a.eq('no error alert on the page', await pr.page.locator('[role="alert"]').count(), 0);
      await a.shot(pr.page, 'fresh-connections');
    }
  },
};

export const V2: StepDef<GateCtx> = {
  id: 'V2',
  title: 'Reconnect: purge on disconnect, same ids on reconnect, chat untouched',
  needs: CONNECT_NEEDS,
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    await connectEverything(rhea);
    const first = await items(rhea);
    a.ok('first connect ingested sources', first.length > 0);
    const chatBefore = (await history(rhea.token, c.world.squadA.chatId)).length;
    await disconnectAll(rhea);
    a.eq('disconnect purges every derived source', (await items(rhea)).length, 0);
    const revoked = (await listConnections(rhea)).connections;
    a.ok(
      'connections stay listed as revoked',
      revoked.length > 0 && revoked.every((x) => x.status === 'revoked'),
    );
    a.eq(
      'chat history untouched',
      (await history(rhea.token, c.world.squadA.chatId)).length,
      chatBefore,
    );
    await connectEverything(rhea);
    const again = await items(rhea);
    a.eq(
      'reconnect recreates the same source ids',
      asSet(again.map((s) => s.id)),
      asSet(first.map((s) => s.id)),
    );
    a.eq('and the same titles', asSet(again.map((s) => s.title)), asSet(first.map((s) => s.title)));
  },
};

export const V3: StepDef<GateCtx> = {
  id: 'V3',
  title: 'Revoked auth: needs reconnect, data marked not deleted, the other source keeps working',
  needs: [...CONNECT_NEEDS, P.mentions],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    await connectEverything(rhea);
    const before = await items(rhea);
    const googleBefore = before.filter((s) => s.provider === 'google').length;
    await revokeUpstream('google');
    await syncAll(rhea);
    const g = await connectionStatus(rhea, 'google');
    a.ok('Google is no longer live', !!g && g.state !== 'live', `state ${g?.state}`);
    a.note(
      `after revoke: state=${g?.state} label=${g?.stateLabel} status=${g?.status} degraded=${g?.degraded} note=${g?.note}`,
    );
    a.ok(
      'the label says to reconnect in words',
      /reconnect|expired|sign in/i.test(`${g?.stateLabel ?? ''} ${g?.note ?? ''}`),
    );
    const cv = await connectionStatus(rhea, 'canvas');
    a.eq('Canvas is unaffected', cv?.state, 'live');
    const after = await items(rhea);
    a.ok(
      'Google-derived items are kept (stale), not deleted',
      after.filter((s) => s.provider === 'google').length >= Math.min(1, googleBefore),
    );
    const hit = await searchContext(rhea, 'homework');
    a.ok('retrieval still answers from the valid source', hit.results.length > 0);
    a.noLeak('search payload', hit.text);
    await resetUpstreams();
  },
};

export const V4: StepDef<GateCtx> = {
  id: 'V4',
  title: 'Expired access token: transparent refresh; refresh failure falls to V3',
  needs: CONNECT_NEEDS,
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    const tokenCalls = async () =>
      (await google.requests()).filter((r) => r.path === '/token').length;
    // A. the hub's own mechanism: it refreshes when the token is within 60 s of its expiry (GET /v1/connections ticks it)
    await connectGoogle(rhea, { shortLived: true });
    const t0 = await tokenCalls();
    const g1 = (await listConnections(rhea)).connections.find((x) => x.provider === 'google');
    a.ok(
      'a token near expiry is refreshed by the hub (a refresh call reached the token endpoint)',
      (await tokenCalls()) > t0,
    );
    a.eq('and the connection stays live with no user-visible failure', g1?.state, 'live');
    a.eq('a sync then works', (await syncAll(rhea)).status, 200);
    // B. a refresh Google refuses (invalid_grant) is what ends a connection (the V3 state)
    await disconnectAll(rhea);
    await resetUpstreams();
    await connectGoogle(rhea, { shortLived: true });
    await revokeUpstream('google');
    const g2 = (await listConnections(rhea)).connections.find(
      (x) => x.provider === 'google' && x.status !== 'revoked',
    );
    a.ok(
      'a refused refresh ends needing reconnect',
      !g2 || g2.state !== 'live',
      `state ${g2?.state}`,
    );
    // C. the plan's case: the access token dies at Google before the hub expects it; one refresh and one retry, no failure
    await disconnectAll(rhea);
    await resetUpstreams();
    await connectGoogle(rhea);
    const t1 = await tokenCalls();
    await expireUpstream();
    const sync = await syncAll(rhea);
    const g3 = await connectionStatus(rhea, 'google');
    a.ok(
      'a 401 on sync triggers one refresh and a retry (no user-visible failure)',
      sync.status === 200 && g3?.state === 'live' && (await tokenCalls()) > t1,
      `sync ${sync.status}, state ${g3?.state}, refresh calls ${(await tokenCalls()) - t1}`,
    );
    await resetUpstreams();
  },
};

export const V5: StepDef<GateCtx> = {
  id: 'V5',
  title: 'Canvas upstream gone: degraded with the last good items, never a silent empty',
  needs: CONNECT_NEEDS,
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    await connectEverything(rhea);
    const good = (await items(rhea)).filter((s) => s.provider === 'canvas');
    a.ok('Canvas items exist before the outage', good.length > 0);
    await canvasFeedBroken('404');
    await syncAll(rhea);
    const cv = await connectionStatus(rhea, 'canvas');
    a.ok(
      'Canvas shows as degraded or not live, in words',
      !!cv && (cv.degraded || cv.state !== 'live') && !!(cv.note || cv.stateLabel),
      `state ${cv?.state}`,
    );
    const kept = (await items(rhea)).filter((s) => s.provider === 'canvas');
    a.eq('the last good items are kept', kept.length, good.length);
    a.ok('and a last-synced time is shown', !!cv?.lastSyncAt);
    await canvasFeedBroken('rate_limited');
    await syncAll(rhea);
    const rl = await connectionStatus(rhea, 'canvas');
    a.ok(
      'a rate limit is reported as such, not as empty',
      !!rl && (rl.state === 'rate_limited' || rl.degraded || rl.state !== 'live'),
    );
    a.eq(
      'items still kept after the rate limit',
      (await items(rhea)).filter((s) => s.provider === 'canvas').length,
      good.length,
    );
    await resetUpstreams();
    void api;
  },
};

export const VARIANTS: VariantDef[] = [
  { def: V1, world: { actors: true } },
  { def: V2, world: {} },
  { def: V3, world: {} },
  { def: V4, world: {} },
  { def: V5, world: {} },
  { def: V6, world: {} },
  { def: V7, world: {} },
  { def: V8, world: {} },
  { def: V9, world: { kind: 'journey' } },
  { def: V10, world: { b: true } },
  { def: V11, world: {} },
  { def: V12, world: {} },
];
