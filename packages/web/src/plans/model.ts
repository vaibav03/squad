export type PlanFilter = 'all' | 'trips' | 'study' | 'active' | 'completed';

export interface PlanSummary {
  id: string;
  kind: 'trip' | 'study';
  title: string;
  status: string;
  active: boolean;
  /** `/squad/chat?group=…&plan=…` target is built by the caller; this is the hub id. */
  updatedAt?: number;
  /** Confirmed trips only: the task the Village cutscene is keyed on. */
  taskId?: string;
}

const DONE = new Set(['confirmed', 'agreed', 'cancelled', 'failed', 'expired', 'done']);
export const isCompleted = (status: string) => DONE.has(status);

const LABEL: Record<string, string> = {
  planning: 'Planning',
  voting: 'Voting',
  confirming: 'Confirming',
  confirmed: 'Agreed',
  failed: 'Needs attention',
  expired: 'Expired',
  cancelled: 'Cancelled',
  draft: 'Draft',
  agreed: 'Agreed',
  done: 'Done',
};
export const planStatusLabel = (s: string) => LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

export function filterPlans(plans: PlanSummary[], f: PlanFilter): PlanSummary[] {
  switch (f) {
    case 'trips':
      return plans.filter((p) => p.kind === 'trip');
    case 'study':
      return plans.filter((p) => p.kind === 'study');
    case 'active':
      return plans.filter((p) => p.active);
    case 'completed':
      return plans.filter((p) => !p.active);
    default:
      return plans;
  }
}

/** Parses `GET /v1/trips` and `GET /v1/plans/current` bodies into summaries; unknown shapes yield nothing. */
export function parsePlans(trips: unknown, current: unknown): PlanSummary[] {
  const out: PlanSummary[] = [];
  const list = (trips as { trips?: unknown } | null)?.trips;
  if (Array.isArray(list))
    for (const t of list) {
      const r = t as { tripId?: unknown; taskId?: unknown; title?: unknown; status?: unknown };
      if (typeof r.tripId === 'string' && typeof r.status === 'string')
        out.push({
          id: r.tripId,
          kind: 'trip',
          title: typeof r.title === 'string' ? r.title : 'Group trip',
          status: r.status,
          active: !isCompleted(r.status),
          ...(r.status === 'confirmed'
            ? { taskId: typeof r.taskId === 'string' ? r.taskId : `task_${r.tripId}` }
            : {}),
        });
    }
  const p = (current as { plan?: unknown } | null)?.plan as
    { planId?: unknown; id?: unknown; title?: unknown; status?: unknown } | null | undefined;
  const pid = p?.planId ?? p?.id;
  if (p && typeof pid === 'string') {
    const status = typeof p.status === 'string' ? p.status : 'draft';
    out.push({
      id: pid,
      kind: 'study',
      title: typeof p.title === 'string' ? p.title : 'Study plan',
      status,
      active: !isCompleted(status),
    });
  }
  return out;
}
