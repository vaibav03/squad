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
  syncConnection,
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

const REVOKED_MSG =
  'Google access was revoked. Imported data was removed. Reconnect to import again.';

export const V3: StepDef<GateCtx> = {
  id: 'V3',
  title:
    'Revoked auth: state revoked, imported data purged (deliberate, privacy first), honest reconnect message, the other source keeps working',
  needs: [...CONNECT_NEEDS, P.mentions],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    await connectEverything(rhea);
    const before = await items(rhea);
    const googleBefore = before.filter((s) => s.provider === 'google').length;
    a.ok('Google items exist before the revoke', googleBefore > 0);
    await revokeUpstream('google');
    await syncAll(rhea);
    const g = await connectionStatus(rhea, 'google');
    a.eq('Google connection state is revoked', g?.state, 'revoked');
    a.note(
      `after revoke: state=${g?.state} label=${g?.stateLabel} status=${g?.status} degraded=${g?.degraded}`,
    );
    a.eq('the label states what happened and what to do', g?.stateLabel, REVOKED_MSG);
    a.ok('the API asks for a reconnect', g?.needsReconnect === true);
    const after = await items(rhea);
    a.eq(
      'imported Google data is purged (privacy first; documented difference from Nook)',
      after.filter((s) => s.provider === 'google').length,
      0,
    );
    const cv = await connectionStatus(rhea, 'canvas');
    a.eq('Canvas is unaffected', cv?.state, 'live');
    const hit = await searchContext(rhea, 'homework');
    a.ok('retrieval still answers from the valid source', hit.results.length > 0);
    a.noLeak('search payload', hit.text);
    await resetUpstreams();
  },
};

export const V4: StepDef<GateCtx> = {
  id: 'V4',
  title:
    'Expired access token: one refresh and retry; a refused refresh is revoked (provider says so) or expired with data kept, never live',
  needs: CONNECT_NEEDS,
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    await resetUpstreams();
    const tokenCalls = async () =>
      (await google.requests()).filter((r) => r.path === '/token').length;
    // A. the hub's own mechanism: it refreshes when the token is within 60 s of its expiry (GET /v1/connections ticks it)
    const t0 = await tokenCalls();
    await connectGoogle(rhea, { shortLived: true });
    const g1 = (await listConnections(rhea)).connections.find((x) => x.provider === 'google');
    a.ok(
      'a token near expiry is refreshed by the hub (a refresh call reached the token endpoint)',
      (await tokenCalls()) > t0,
    );
    a.eq('and the connection stays live with no user-visible failure', g1?.state, 'live');
    a.eq('a sync then works', (await syncAll(rhea)).status, 200);
    // B. a refresh Google refuses with invalid_grant (the provider says the grant is revoked) is the V3 state
    await disconnectAll(rhea);
    await resetUpstreams();
    await connectGoogle(rhea, { shortLived: true });
    await revokeUpstream('google');
    const g2 = (await listConnections(rhea)).connections.find(
      (x) => x.provider === 'google' && x.status !== 'revoked',
    );
    const g2r = await connectionStatus(rhea, 'google');
    a.ok('a refused refresh never leaves the state live', !g2 && g2r?.state !== 'live');
    a.eq('invalid_grant ends revoked with the honest message', g2r?.stateLabel, REVOKED_MSG);
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
    a.eq('exactly one refresh for that 401', (await tokenCalls()) - t1, 1);
    // D. a refresh the provider refuses without saying "revoked": expired, data KEPT, sync stopped, stale, reconnect prompt
    await disconnectAll(rhea);
    await resetUpstreams();
    await connectGoogle(rhea, { shortLived: true });
    await syncAll(rhea);
    const kept = (await items(rhea)).filter((s) => s.provider === 'google').length;
    a.ok('Google data was imported before the refusal', kept > 0);
    await google.failRefresh(99);
    const g4 = (await listConnections(rhea)).connections.find(
      (x) => x.provider === 'google' && x.status !== 'revoked',
    );
    a.eq('a refused refresh (not invalid_grant) ends expired, never live', g4?.state, 'expired');
    a.ok('and asks for a reconnect', g4?.needsReconnect === true);
    a.eq(
      'imported data is kept',
      (await items(rhea)).filter((s) => s.provider === 'google').length,
      kept,
    );
    a.eq(
      'sync is stopped (409 connection_expired)',
      g4 ? (await syncConnection(rhea, g4.id)).status : 0,
      409,
    );
    const hit = await searchContext(rhea, 'central limit theorem standard error');
    const stale = hit.results.filter((h) => h.provenance?.startsWith('google'));
    a.ok(
      'retrieval still answers from the kept data and flags it stale',
      stale.length > 0 && stale.every((h) => (h as { stale?: boolean }).stale === true),
      `${stale.length} google hits`,
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
  { def: V9, world: { kind: 'journey', actors: true } },
  { def: V10, world: { b: true } },
  { def: V11, world: {} },
  { def: V12, world: {} },
];
