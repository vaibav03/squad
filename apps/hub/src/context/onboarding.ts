// Onboarding state per viewer: skip marker and the sharing choice. Persisted; never holds source titles.
import type { Db } from '@squad/core';
import { contextServiceFor } from './service';
import type { HubDeps } from '../types';

export type SharingChoice = 'private' | 'squad';

export interface OnboardingRow {
  skippedAt: number | null;
  sharingSquad: string | null;
  sharingChoice: SharingChoice | null;
  sharingAt: number | null;
}

export function createOnboardingStore(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ctx_onboarding(
    user_id TEXT PRIMARY KEY, skipped_at INTEGER, sharing_squad TEXT, sharing_choice TEXT, sharing_at INTEGER)`);
  const get = (id: string): OnboardingRow => {
    const r = db.prepare('SELECT * FROM ctx_onboarding WHERE user_id=?').get(id) as
      | { skipped_at: number | null; sharing_squad: string | null; sharing_choice: string | null; sharing_at: number | null }
      | undefined;
    return {
      skippedAt: r?.skipped_at ?? null,
      sharingSquad: r?.sharing_squad ?? null,
      sharingChoice: (r?.sharing_choice as SharingChoice | null) ?? null,
      sharingAt: r?.sharing_at ?? null,
    };
  };
  const put = (id: string, p: Partial<OnboardingRow>) => {
    const n = { ...get(id), ...p };
    db.prepare('INSERT OR REPLACE INTO ctx_onboarding VALUES(?,?,?,?,?)').run(
      id,
      n.skippedAt,
      n.sharingSquad,
      n.sharingChoice,
      n.sharingAt,
    );
  };
  return { get, put };
}
export type OnboardingStore = ReturnType<typeof createOnboardingStore>;

const store = new WeakMap<HubDeps, OnboardingStore>();
export const onboardingFor = (deps: HubDeps): OnboardingStore => {
  let s = store.get(deps);
  if (!s) store.set(deps, (s = createOnboardingStore(deps.db)));
  return s;
};

/** Calendar items (titles) are never shared by default: free/busy only. */
const CALENDAR = new Set(['gcal_event', 'canvas_event']);

/**
 * Applies the viewer's sharing choice to their imported NON-calendar sources: `squad` shares them with the chosen squad,
 * `private` (the default, also when nothing was chosen) shares nothing. Safe to call after every import.
 */
export function applySharingChoice(deps: HubDeps, userId: string): number {
  const o = onboardingFor(deps).get(userId);
  if (o.sharingChoice !== 'squad' || !o.sharingSquad || !deps.squads.isMember(o.sharingSquad, userId)) return 0;
  const svc = contextServiceFor(deps);
  let n = 0;
  for (const c of svc.store.connectionsOf(userId))
    if (c.status !== 'revoked')
      for (const s of svc.store.sourcesOfConnection(c.id))
        if (!CALENDAR.has(s.kind) && !s.sharedWith.includes(o.sharingSquad)) {
          svc.store.share(s.id, o.sharingSquad);
          n++;
        }
  return n;
}
