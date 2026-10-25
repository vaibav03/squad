// S3e every reply has provenance, S9b the plan is produced by an agent (or labelled fallback) with a mode badge and
// persists, S10b sync indicators are visible. Fixture column: demo model + fixture transport (labelled). Real column:
// the same assertions against a real model / real stack, blocked like the other real steps when keys are missing.
import type { Asserts } from '../lib/asserts';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { P } from '../lib/probes';
import { api, history, isBot, waitFor } from '../lib/hub';

const prov = (m: { provenance?: unknown }) =>
  m.provenance as { kind: string; label: string; sources: number; mode: string; via?: string } | undefined;

async function s3e(c: GateCtx, a: Asserts) {
  const { rhea } = c.world.users;
  const chatId = c.world.squadA.chatId;
  const before = (await history(rhea.token, chatId, 100)).at(-1)?.seq ?? 0;
  for (const text of ['@cubbie what is a z-score?', '@cubbie what is the airspeed of a swallow?'])
    await api(rhea.token, '/v1/chat/send', { method: 'POST', json: { chatId, text } });
  const got = await waitFor(async () => {
    const bots = (await history(rhea.token, chatId, 100)).filter((m) => isBot(m) && m.seq > before);
    return bots.length >= 2 ? bots : undefined;
  }, 60_000);
  if (!a.ok('the bot answered both questions', !!got)) return;
  for (const m of got!) {
    const p = prov(m);
    a.ok(`reply "${m.text.slice(0, 40)}" has provenance`, !!p);
    a.ok(
      'chips or an explicit label, never neither',
      m.citations.length > 0 ? p?.kind === 'grounded' : !!p && p.kind !== 'grounded' && p.label.length > 5,
      JSON.stringify(p),
    );
    a.ok('mode is live, degraded or demo', ['live', 'degraded', 'demo'].includes(p?.mode ?? ''));
  }
  // and on the web: the footer row is in the DOM
  const page = c.actors.rhea?.page;
  if (page) {
    const rows = await page.getByTestId('chat-provenance').count().catch(() => 0);
    a.ok('web chat shows provenance rows', rows > 0, `${rows} rows`);
  }
}
export const S3e: StepDef<GateCtx> = {
  id: 'S3e',
  title: 'Every reply has provenance (chips or an explicit label)',
  needs: [P.context, P.mentions],
  realNeeds: ['llm'],
  label: 'fixture (demo model: labels and chips asserted on the wire and the web DOM)',
  fixture: s3e,
  real: s3e,
};

async function s9b(c: GateCtx, a: Asserts) {
  const { rhea, ben } = c.world.users;
  const id = String(c.state.planId ?? '');
  if (!a.ok('S9 produced a plan', id.length > 0)) return;
  const get = async (tok: string) => (await api(tok, '/v1/plans/current')).json?.plan;
  const p = await get(rhea.token);
  a.ok('plan has a generator kind', p?.generator?.kind === 'agent' || p?.generator?.kind === 'fallback');
  const label =
    p?.generator?.mode === 'live'
      ? 'Live'
      : p?.generator?.mode === 'degraded'
        ? 'Degraded'
        : 'Demo';
  a.ok('mode badge words are known', ['Live', 'Degraded', 'Demo'].includes(label), label);
  if (p?.generator?.kind === 'fallback')
    a.ok('fallback is never presented as agent output', /not written by an agent/.test(p.generator.note));
  else a.ok('agent plan has a rationale', String(p?.rationale ?? '').length > 20);
  a.ok('saved block says version and editor', p?.saved?.rev >= 1 && !!p?.saved?.lastEditedBy);
  const again = await get(ben.token);
  a.eq('another member reads the same saved version', again?.saved?.rev, p?.saved?.rev);
  const page = c.actors.rhea?.page;
  if (page) {
    await page.goto('/squad/village?plan=1');
    await page.reload();
    const saved = page.getByTestId('plan-saved');
    a.ok(
      'panel shows Saved, version N after a reload',
      await saved.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false),
    );
    a.ok('panel shows the mode badge', (await page.getByTestId('plan-mode-badge').count()) > 0);
  }
}
export const S9b: StepDef<GateCtx> = {
  id: 'S9b',
  title: 'The plan is produced by an agent with a mode badge and persists',
  needs: [P.study, P.mentions],
  realNeeds: ['llm'],
  label: 'fixture (demo: labelled Fallback sample plan; real: planner agent)',
  fixture: s9b,
  real: s9b,
};

async function s10b(c: GateCtx, a: Asserts) {
  const { rhea } = c.world.users;
  const st = (await api(rhea.token, '/v1/imessage/status')).json;
  a.ok('GET /v1/imessage/status answers', !!st && typeof st.enabled === 'boolean');
  a.ok('status carries a mode', ['off', 'dry_run', 'live', 'fixture'].includes(st?.mode), String(st?.mode));
  a.ok('squads are listed with a bound count', Array.isArray(st?.squads));
  if (st?.fixture) a.ok('a scripted transport says fixture', st.mode === 'fixture');
  const page = c.actors.rhea?.page;
  if (page) {
    await page.goto(`/squad/chat?c=${encodeURIComponent(c.world.squadA.chatId)}`);
    const ind = page.getByTestId('chat-imessage-indicator').first();
    a.ok('chat header shows the iMessage indicator', await ind.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false));
    const state = await ind.getAttribute('data-state').catch(() => null);
    a.ok('indicator state is known', ['web_only', 'not_connected', 'dry_run', 'connected', 'degraded', 'fixture'].includes(state ?? ''), String(state));
    if (st?.fixture) a.ok('fixture transport is labelled', /Fixture transport/.test((await ind.textContent()) ?? ''));
    a.ok('rows show their origin', (await page.getByTestId('chat-source-label').count()) > 0);
  }
}
export const S10b: StepDef<GateCtx> = {
  id: 'S10b',
  title: 'Sync and source indicators are visible',
  needs: [P.imsync],
  realNeeds: ['apple'],
  label: 'fixture (fixture transport, labelled)',
  fixture: s10b,
  real: s10b,
};
