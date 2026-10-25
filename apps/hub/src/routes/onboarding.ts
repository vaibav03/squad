import { Hono } from 'hono';
import { z } from 'zod';
import { type IntegrationState } from '@squad/core';
import { requireUser } from '../auth';
import { contextServiceFor } from '../context/service';
import { applySharingChoice, onboardingFor } from '../context/onboarding';
import { importCounts, integrationStateOf, rollupState } from '../context/state';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Sharing = z.strictObject({
  squadId: z.string().min(1).max(64),
  choice: z.enum(['private', 'squad']),
});

/**
 * GET /v1/onboarding (viewer-scoped): where the person is in first-run setup, derived from real server state.
 * POST /v1/onboarding/skip, POST /v1/onboarding/sharing {squadId, choice} persist the two choices. Default is private.
 */
export function createOnboardingRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireUser(deps);

  const provider = (uid: string, p: 'canvas' | 'google') => {
    const svc = contextServiceFor(deps);
    const mine = svc.store.connectionsOf(uid).filter((c) => c.provider === p);
    const roll = rollupState(mine.map((c) => integrationStateOf(c, svc.store.syncState(c.id))));
    const active = mine.filter((c) => c.status !== 'revoked');
    return {
      state: roll.state as IntegrationState,
      sub: roll.sub,
      counts: importCounts(active.flatMap((c) => svc.store.sourcesOfConnection(c.id))),
      lastSyncAt: Math.max(0, ...active.map((c) => c.lastSyncAt ?? 0)) || null,
      demo: active.some((c) => c.mode === 'fixture'),
    };
  };

  const view = (uid: string) => {
    const o = onboardingFor(deps).get(uid);
    const identityDone = Boolean(deps.accounts.user(uid)?.name || deps.directory.student?.(uid));
    const canvas = provider(uid, 'canvas');
    const google = provider(uid, 'google');
    const connected = [canvas, google].some((x) => x.state !== 'not_connected');
    const sharingChosen = o.sharingChoice !== null;
    const nextStep = !identityDone
      ? 'identity'
      : !connected && o.skippedAt === null
        ? 'connect'
        : connected && !sharingChosen && o.skippedAt === null
          ? 'sharing'
          : 'done';
    return {
      identityDone,
      integrations: { canvas, google },
      sharingChosen,
      sharing: o.sharingChoice
        ? { squadId: o.sharingSquad, choice: o.sharingChoice }
        : { squadId: null, choice: 'private' as const },
      skipped: o.skippedAt === null ? null : { at: o.skippedAt },
      nextStep,
    };
  };

  r.get('/v1/onboarding', need, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(view(c.get('user').id));
  });
  r.post('/v1/onboarding/skip', need, (c) => {
    const uid = c.get('user').id;
    const cur = onboardingFor(deps).get(uid);
    onboardingFor(deps).put(uid, { skippedAt: cur.skippedAt ?? deps.now() });
    return c.json(view(uid));
  });
  r.post('/v1/onboarding/sharing', need, async (c) => {
    const uid = c.get('user').id;
    const p = Sharing.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (!deps.squads.isMember(p.data.squadId, uid))
      return c.json({ error: { code: 'not_found' } }, 404);
    const prev = onboardingFor(deps).get(uid);
    // Switching back to private stops FUTURE default sharing; it also unshares what the earlier choice shared.
    if (p.data.choice === 'private' && prev.sharingChoice === 'squad' && prev.sharingSquad) {
      const svc = contextServiceFor(deps);
      for (const cn of svc.store.connectionsOf(uid))
        for (const s of svc.store.sourcesOfConnection(cn.id))
          svc.store.unshare(s.id, prev.sharingSquad);
    }
    onboardingFor(deps).put(uid, {
      sharingChoice: p.data.choice,
      sharingSquad: p.data.squadId,
      sharingAt: deps.now(),
    });
    const shared = applySharingChoice(deps, uid);
    return c.json({ ...view(uid), sharedNow: shared });
  });

  /**
   * DEV/DEMO ONLY. POST /v1/dev/reset-onboarding resets the CALLER's own first-run state (skip + sharing choice) and
   * removes the caller's own Canvas/Google connections and imports, so E2E and manual QA can replay the fresh-user
   * flow with a throwaway student. It never touches another user, a squad, or chat history, and it answers 404 in
   * production or when dev sign-in is off.
   */
  r.post('/v1/dev/reset-onboarding', need, async (c) => {
    if (deps.config.production || !deps.config.devLogin)
      return c.json({ error: { code: 'not_found' } }, 404);
    const uid = c.get('user').id;
    const svc = contextServiceFor(deps);
    let removed = 0;
    for (const cn of svc.store.connectionsOf(uid)) {
      if (cn.status !== 'revoked') await svc.disconnect(uid, cn.id);
      svc.store.deleteConnection(cn.id);
      removed += 1;
    }
    onboardingFor(deps).reset(uid);
    return c.json({ reset: true, connectionsRemoved: removed, ...view(uid) });
  });
  return r;
}
