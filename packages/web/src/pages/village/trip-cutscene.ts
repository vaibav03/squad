/**
 * Durable "play the trip cutscene" hand-off. A confirmed trip is recorded as pending (localStorage, per viewer) and
 * the Village plays it only when the world is ready, nothing modal is open and the tab is visible. It is marked
 * played only after the cutscene actually started, so it plays once.
 */
export interface PendingTrip {
  taskId: string;
  confirmedAt: number;
  /** Replay from the query string or the "Watch the trip" button: plays even if it was played before. */
  force?: boolean;
}
export const CUTSCENE_WINDOW_MS = 24 * 60 * 60 * 1000;
const pendingKey = (v: string) => `squad.cutscene.pending.${v}`;
const playedKey = (v: string) => `squad.cutscene.played.${v}`;

const read = (k: string): unknown[] => {
  try {
    const raw = globalThis.localStorage?.getItem(k);
    const j: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
};
const write = (k: string, v: unknown) => {
  try {
    globalThis.localStorage?.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked: the in-page gate still works for this load */
  }
};

export function readPending(viewer: string): PendingTrip[] {
  return read(pendingKey(viewer)).filter(
    (p): p is PendingTrip =>
      !!p &&
      typeof (p as PendingTrip).taskId === 'string' &&
      typeof (p as PendingTrip).confirmedAt === 'number',
  );
}
export const readPlayed = (viewer: string): string[] =>
  read(playedKey(viewer)).filter((x): x is string => typeof x === 'string');
export const isPlayed = (viewer: string, taskId: string) => readPlayed(viewer).includes(taskId);

export function addPending(viewer: string, p: PendingTrip): void {
  const cur = readPending(viewer).filter((x) => x.taskId !== p.taskId);
  write(pendingKey(viewer), [...cur, p]);
}
export function markPlayed(viewer: string, taskId: string): void {
  write(pendingKey(viewer), readPending(viewer).filter((x) => x.taskId !== taskId));
  const played = readPlayed(viewer);
  if (!played.includes(taskId)) write(playedKey(viewer), [...played, taskId].slice(-50));
}

/** Most recent pending trip: forced ones first, then unplayed within 24 h of confirming. */
export function nextPending(viewer: string, now = Date.now()): PendingTrip | undefined {
  const played = new Set(readPlayed(viewer));
  const ok = readPending(viewer).filter(
    (p) => p.force || (!played.has(p.taskId) && now - p.confirmedAt <= CUTSCENE_WINDOW_MS),
  );
  const forced = ok.filter((p) => p.force);
  const pool = forced.length ? forced : ok;
  return pool.sort((a, b) => b.confirmedAt - a.confirmedAt)[0];
}

export interface TripSummaryRow {
  taskId?: string;
  tripId?: string;
  status?: string;
  confirmedAt?: number;
}
/** Confirmed trips from `GET /v1/trips` (the hub's `trips` array), usable as a replay target. */
export function confirmedTrips(body: unknown): { taskId: string; confirmedAt: number }[] {
  const list = (body as { trips?: unknown } | null)?.trips;
  if (!Array.isArray(list)) return [];
  const out: { taskId: string; confirmedAt: number }[] = [];
  for (const t of list as TripSummaryRow[]) {
    const taskId = t.taskId ?? (t.tripId ? `task_${t.tripId}` : undefined);
    if (t.status === 'confirmed' && taskId)
      out.push({ taskId, confirmedAt: typeof t.confirmedAt === 'number' ? t.confirmedAt : 0 });
  }
  return out;
}
/** Self-heal: records every confirmed, unplayed trip confirmed in the last 24 h as pending. */
export function healFromTrips(viewer: string, body: unknown, now = Date.now()): void {
  for (const t of confirmedTrips(body))
    if (
      t.confirmedAt > 0 &&
      now - t.confirmedAt <= CUTSCENE_WINDOW_MS &&
      !isPlayed(viewer, t.taskId) &&
      !readPending(viewer).some((p) => p.taskId === t.taskId)
    )
      addPending(viewer, { taskId: t.taskId, confirmedAt: t.confirmedAt });
}

/** Visible modal UI that the cutscene must not start under. The chat dock is a side panel, not blocking. */
export function isBlockingUi(root: ParentNode = document): boolean {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    if (el.closest('[data-testid="chat-dock"]') || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
  }
  return false;
}

export interface GateDeps {
  next(): PendingTrip | undefined;
  ready(): boolean;
  blocking(): boolean;
  visible(): boolean;
  /** Starts the cutscene; true only if it really started. */
  start(p: PendingTrip): boolean;
  onStarted(p: PendingTrip): void;
}
/** One gate check. Returns true when a cutscene was started (and consumed). */
export function runGate(d: GateDeps): boolean {
  if (!d.ready() || !d.visible() || d.blocking()) return false;
  const p = d.next();
  if (!p || !d.start(p)) return false;
  d.onStarted(p);
  return true;
}

/** Hands the cutscene to the world module (`squad:play-trip`). True if it started. */
export function playInWorld(p: { taskId: string; squadId?: string }): boolean {
  const detail = { taskId: p.taskId, squadId: p.squadId ?? 'squad', force: true, started: false };
  window.dispatchEvent(new CustomEvent('squad:play-trip', { detail }));
  return detail.started;
}
