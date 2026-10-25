// S1 connect, S2 ingest, S3 retrieve. FIXTURE contracts follow docs/plans/RELEASE-GATE.md; routes in lib/contract.ts.
import { P } from '../lib/probes';
import { SENTINELS } from '../lib/config';
import { api } from '../lib/hub';
import { canvas, google, im } from '../lib/fakes/client';
import { ASSIGNMENTS, DRIVE_FILES, EVENTS, FACTS } from '../lib/fakes/content';
import { MINIMAL_GOOGLE_SCOPES, ROUTES, state } from '../lib/contract';
import { defaultSentinels } from '../lib/asserts';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import {
  asSet,
  ask,
  connectCanvas,
  connectGoogle,
  dbRows,
  items,
  optIn,
  pickDriveFile,
  syncAll,
} from './flows';

export const S1: StepDef<GateCtx> = {
  id: 'S1',
  title: 'Connect Canvas and Google Workspace with minimal permissions',
  needs: [P.connectors],
  realNeeds: ['google_client', 'google_account', 'canvas_feed'],
  fixture: async (c, a) => {
    const u = c.world.users.rhea;
    await google.reset();
    await canvas.reset();
    const cv = await connectCanvas(u);
    a.ok('canvas connect accepted', cv.status < 300, `status ${cv.status}`);
    a.ok('canvas feed URL secret never echoed back', !cv.text.includes(SENTINELS.feedSecret));

    const g = await connectGoogle(u);
    if (!g.ok) a.fail('google consent flow', g.why);
    else {
      a.eq('requested scopes equal exactly the allowed set', asSet(g.requested), asSet(MINIMAL_GOOGLE_SCOPES));
      a.ok('callback accepted', g.callbackStatus < 400, `status ${g.callbackStatus}`);
      const grants = await google.grants();
      a.eq('granted scopes equal exactly the allowed set (no more)', asSet(grants.at(-1)?.scopes ?? []), asSet(MINIMAL_GOOGLE_SCOPES));
      const gr = await google.requests();
      a.ok('hub never asked Google for event titles (calendar.readonly)', !gr.some((r) => r.scope?.endsWith('calendar.readonly')));
    }
    const picked = await pickDriveFile(u);
    a.ok('Picker selection accepted', picked.status < 300, `status ${picked.status}`);

    const conns = await api(u.token, ROUTES.connections);
    const list: any[] = conns.json?.connections ?? [];
    const by = (p: string) => list.find((x) => x.provider === p);
    a.ok('connections lists canvas and google', !!by('canvas') && !!by('google'));
    const hint = JSON.stringify(by('canvas')?.hint ?? '');
    a.ok('canvas shows host + last 4 only', /localhost/.test(hint) && !hint.includes(SENTINELS.feedSecret));
    a.noLeak('connections API', conns.text, [SENTINELS.feedSecret, SENTINELS.refreshToken]);

    const st = (await api(null, ROUTES.status)).json;
    a.eq('status: canvas live', state(st?.connections?.canvas ?? by('canvas')), 'live');
    a.eq('status: google live', state(st?.connections?.google ?? by('google')), 'live');
    a.noLeak('status', JSON.stringify(st), [SENTINELS.feedSecret, SENTINELS.refreshToken]);

    // refresh token and feed URL are stored encrypted: absent as plaintext from the whole database
    const dump = await im.dbDump();
    a.ok('refresh token encrypted at rest (no plaintext in DB)', !dump.includes(SENTINELS.refreshToken));
    a.ok('feed URL secret encrypted at rest (no plaintext in DB)', !dump.includes(SENTINELS.feedSecret));
    const conn = (await dbRows('hub_connections')).filter((r) => String(r.userId ?? r.user_id) === u.id);
    a.ok('hub_connections rows exist for the user', conn.length >= 2, `rows ${conn.length}`);
    if (c.actors.rhea) {
      for (const b of c.actors.rhea.bodies)
        if (b.includes(SENTINELS.refreshToken) || b.includes(SENTINELS.feedSecret)) a.fail('token in a web response', 'secret in HTTP body seen by the browser');
      const ls = await c.actors.rhea.page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })).catch(() => '');
      a.noLeak('web storage', ls, [SENTINELS.feedSecret, SENTINELS.refreshToken]);
    }
  },
};

export const S2: StepDef<GateCtx> = {
  id: 'S2',
  title: 'Ingest and normalize permitted context',
  needs: [P.context, P.connectors],
  realNeeds: ['google_client', 'canvas_feed'],
  fixture: async (c, a) => {
    const u = c.world.users.rhea;
    const sync = await syncAll(u);
    a.ok('sync accepted', sync.status < 300, `status ${sync.status}`);
    const first = await items(u);
    const kinds = (k: string) => first.filter((i) => i.kind === k);
    a.eq('3 assignments', kinds('assignment').length, ASSIGNMENTS.length);
    a.eq('2 events', kinds('event').length, EVENTS.length);
    a.eq('1 Drive file (picked only)', kinds('file').length, 1);
    a.ok('picked Drive file name present', first.some((i) => String(i.title).includes(DRIVE_FILES.picked.name)));
    a.ok('stable ids and contentHash on every item', first.length > 0 && first.every((i) => i.id && i.contentHash));
    a.ok('every item defaults to visibility=private', first.every((i) => i.visibility === 'private'));
    a.ok('every item has an externalUrl or a source label', first.every((i) => i.externalUrl || i.source));
    c.state.canvasItemIds = first.filter((i) => i.source === 'canvas').map((i) => i.id);

    await syncAll(u);
    const second = await items(u);
    a.eq('re-sync is idempotent (count unchanged)', second.length, first.length);
    a.eq('re-sync keeps ids and hashes', second.map((i) => `${i.id}:${i.contentHash}`).sort(), first.map((i) => `${i.id}:${i.contentHash}`).sort());

    const busy = await dbRows('hub_busy_blocks');
    a.eq('5 busy blocks', busy.length, 5);
    const busyJson = JSON.stringify(busy);
    a.ok('titles absent from hub_busy_blocks', !busyJson.includes(SENTINELS.calTitle) && !/office hours|review session/i.test(busyJson));
    a.ok('grades and submissions absent from the database', !(await im.dbDump()).includes(SENTINELS.grade));
    a.ok('unpicked Drive file never fetched or stored', !(await im.dbDump()).includes(SENTINELS.driveHidden));

    const ben = c.world.users.ben;
    const before = await items(ben, c.world.squadA.id);
    a.eq('squad retrieval returns zero while opt-in is off', before.length, 0);
    await optIn(u, c.world.squadA.id, true);
    const after = await items(ben, c.world.squadA.id);
    a.ok('after opt-in the squad sees assignments', after.some((i) => i.kind === 'assignment'));
    a.ok('calendar busy never retrievable by the squad', !after.some((i) => i.source === 'google-calendar'));
    a.ok('squad view contains no sentinel', !defaultSentinels().some((s) => JSON.stringify(after).includes(s)));
  },
};

export const S3: StepDef<GateCtx> = {
  id: 'S3',
  title: 'Agents retrieve permitted context with verified citations',
  needs: [P.context, P.mentions],
  fixture: async (c, a) => {
    const rhea = c.world.users.rhea;
    const chatId = c.world.squadA.chatId;
    const { reply } = await ask(rhea, chatId, `@cubbie ${FACTS.hw4Question}`);
    if (!a.ok('a bot answer arrived', !!reply)) return;
    const cites = (reply!.citations ?? []) as any[];
    a.ok('answer carries at least one citation', cites.length >= 1);
    a.ok('citation names a canvas source', cites.some((x) => x.source?.kind === 'canvas'));
    a.ok('answer mentions the assignment', reply!.text.includes(FACTS.hw4Needle));
    const all = await items(rhea);
    for (const ct of cites) {
      const it = all.find((i) => i.id === ct.itemId);
      a.ok(`citation ${ct.label} resolves to a stored item`, !!it);
      if (ct.quote && it) a.ok('verified: quote present verbatim in the stored item', String(it.text ?? it.title ?? '').includes(ct.quote));
    }
    c.state.answerItemIds = cites.map((x) => x.itemId).sort();
    c.state.answerMsgId = reply!.id;
    a.noLeak('answer text', reply!.text);
    a.noRawIds('answer text', reply!.text);
    a.modeBadge('answer', reply!.demo ? 'Demo' : reply!.text, c.llm.llm);

    const ben = c.world.users.ben;
    const unsupported = await ask(ben, chatId, `@cubbie ${FACTS.unsupported}`);
    a.ok('unsupported question returns NOT_IN_MATERIALS, never an invented citation', !!unsupported.reply && (unsupported.reply.citations ?? []).length === 0 && /not in (the|your|any)? ?materials/i.test(unsupported.reply.text));

    if (c.actors.rhea) {
      const chip = c.actors.rhea.page.locator('[data-testid="chat-citation-chip"]').first();
      const shown = await chip.waitFor({ timeout: 15_000 }).then(() => true, () => false);
      a.ok('citation chip visible in web chat', shown);
      if (shown) {
        await chip.click();
        const ex = c.actors.rhea.page.getByTestId('chat-citation-excerpt');
        a.ok('chip opens the source viewer', await ex.waitFor({ timeout: 8000 }).then(() => true, () => false));
        const link = await c.actors.rhea.page.locator('[data-testid="chat-citation-excerpt"] a[href^="http"]').first().getAttribute('href').catch(() => null);
        a.ok('source viewer links to the external Canvas URL', !!link && link.includes('/courses/'));
        await a.shot(c.actors.rhea.page, 'citation-source-viewer');
      }
    }
  },
};
