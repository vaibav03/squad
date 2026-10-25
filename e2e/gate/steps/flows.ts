// Reusable journey fragments (used by the steps and by the variants). All are API-level and side-effect aware.
import { SENTINELS } from '../lib/config';
import { api, history, isBot, waitBot, type HMsg } from '../lib/hub';
import { canvas, google, im, type World, type WorldUser } from '../lib/fakes/client';
import { DRIVE_FILES } from '../lib/fakes/content';
import { ROUTES } from '../lib/contract';

export const asSet = (x: string[]) => [...new Set(x)].sort();

export async function connectCanvas(u: WorldUser) {
  return api(u.token, ROUTES.connectCanvas, { method: 'POST', json: { feedUrl: canvas.feedUrl() } });
}

/** Drives the whole consent dance against the fake Google; returns what was requested and what the hub answered. */
export async function connectGoogle(u: WorldUser, opts: { replayCallback?: boolean } = {}) {
  const start = await api(u.token, ROUTES.connectGoogleStart);
  const consentUrl: string | undefined = start.headers.get('location') ?? start.json?.url;
  if (!consentUrl) return { ok: false as const, why: `no consent url (status ${start.status})` };
  const consent = await fetch(consentUrl);
  const html = await consent.text();
  const requested = (new URL(consentUrl).searchParams.get('scope') ?? '').split(' ').filter(Boolean);
  const allow = /id="allow" href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (!allow) return { ok: false as const, why: 'fake consent page has no allow link' };
  const cb = new URL(allow);
  const cbPath = cb.pathname + cb.search;
  const first = await api(u.token, cbPath);
  const replay = opts.replayCallback ? await api(u.token, cbPath) : undefined;
  return { ok: true as const, requested, callbackStatus: first.status, replayStatus: replay?.status, consentUrl };
}

export async function pickDriveFile(u: WorldUser) {
  await google.pick([DRIVE_FILES.picked.id]);
  return api(u.token, ROUTES.connectGooglePicked, {
    method: 'POST',
    json: { fileIds: [DRIVE_FILES.picked.id] },
  });
}

export async function syncAll(u: WorldUser) {
  return api(u.token, ROUTES.contextSync, { method: 'POST', json: {} });
}

export async function items(u: WorldUser, squadId?: string): Promise<any[]> {
  const r = await api(u.token, ROUTES.contextItems(squadId));
  return r.status === 200 ? (r.json.items ?? []) : [];
}

export async function optIn(u: WorldUser, squadId: string, on = true) {
  return api(u.token, ROUTES.contextSharing(squadId), {
    method: 'PUT',
    json: { calendar: false, assignments: on, files: on },
  });
}

export async function connectEverything(u: WorldUser) {
  const c = await connectCanvas(u);
  const g = await connectGoogle(u);
  const p = await pickDriveFile(u);
  const s = await syncAll(u);
  return { c, g, p, s };
}

/** Send as a web user into the squad group chat; resolves with the bot reply that follows. */
export async function ask(u: WorldUser, chatId: string, text: string, ms = 45_000) {
  const before = (await history(u.token, chatId)).reduce((n, m) => Math.max(n, m.seq), 0);
  const sent = await api(u.token, '/v1/chat/send', { method: 'POST', json: { chatId, text } });
  const reply = await waitBot(u.token, chatId, () => true, before, ms);
  return { sent, reply, before };
}

/** Bind the world's squad A group chat by texting `join <code>` from Rhea's phone. */
export async function bindGroup(w: World, which: 'A' | 'B' = 'A') {
  const sq = which === 'A' ? w.squadA : w.squadB!;
  const owner = which === 'A' ? w.users.rhea : w.users.dan!;
  await im.say(sq.chat, owner.phone, `join ${sq.invite}`);
  return sq;
}

/** Outbound texts the fake Apple received for a chat, minus the join confirmation. */
export async function outboundTo(chat: string): Promise<string[]> {
  const r = await im.sent(chat);
  return r.sent.map((s) => s.text ?? '').filter((t) => !/joined|welcome|you're in|linked/i.test(t));
}

export const hubBots = (msgs: HMsg[]) => msgs.filter(isBot);

/** Every table row JSON from the hub DB (gate-hub control), for storage-level assertions. */
export async function dbRows(table: string): Promise<any[]> {
  const dump = JSON.parse(await im.dbDump()) as Record<string, any[]>;
  return dump[table] ?? [];
}
export const sentinelInDb = async (needle: string) => (await im.dbDump()).includes(needle);

export const SENT = SENTINELS;
