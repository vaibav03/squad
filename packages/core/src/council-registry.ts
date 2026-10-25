// Who owns a council run (A2A privacy). The agent runtime registers a run when it starts; the hub's per-viewer event
// filter reads it (`FilterCtx.councils.ownerOf`). In-memory, capped, process-local: a run unknown here is dropped by the
// filter (default deny), which is also what happens after a restart.
export interface CouncilRunOwner {
  askedBy: string;
  private: boolean;
}

const MAX_RUNS = 1000;
const owners = new Map<string, CouncilRunOwner>();

export function registerCouncilRun(correlationId: string, owner: CouncilRunOwner): void {
  owners.delete(correlationId);
  owners.set(correlationId, owner);
  if (owners.size > MAX_RUNS) owners.delete(owners.keys().next().value as string);
}

export function councilRunOwner(correlationId: string): CouncilRunOwner | undefined {
  return owners.get(correlationId);
}

// Action items of a run (the chair's `actions` stage). Councils that are not CouncilService runs (Round Table, Debate)
// have no CouncilResult, so the hub resolves `POST /v1/council/:id/actions/*` from here. The client still names an item
// by id only; the title is always the one recorded by the run.
export interface RecordedCouncilAction {
  id: string;
  title: string;
}
const MAX_ACTIONS_PER_RUN = 4;
const actionsByRun = new Map<string, RecordedCouncilAction[]>();

export function recordCouncilAction(correlationId: string, a: RecordedCouncilAction): void {
  const cur = actionsByRun.get(correlationId) ?? [];
  actionsByRun.delete(correlationId);
  if (cur.length < MAX_ACTIONS_PER_RUN && !cur.some((x) => x.id === a.id)) cur.push(a);
  actionsByRun.set(correlationId, cur);
  if (actionsByRun.size > MAX_RUNS) actionsByRun.delete(actionsByRun.keys().next().value as string);
}

export function councilRunActions(correlationId: string): RecordedCouncilAction[] {
  return [...(actionsByRun.get(correlationId) ?? [])];
}

// Run metadata for the hub's persisted council runs (question, council, honest transport, who sits where). Public words only:
// the runtime records it at startRun; `private` runs keep the question out of other viewers' records (the hub filters).
export interface CouncilRunMeta {
  councilKey: string;
  question: string;
  transport: {
    kind: 'stream-text' | 'live-audio' | 'demo';
    label: string;
    requested?: 'stream' | 'live';
    why?: string;
  };
  roster: { id: string; role: string; parent?: string; displayName: string }[];
  startedAt: number;
}
const metaByRun = new Map<string, CouncilRunMeta>();

export function recordCouncilRunMeta(correlationId: string, m: CouncilRunMeta): void {
  metaByRun.delete(correlationId);
  metaByRun.set(correlationId, m);
  if (metaByRun.size > MAX_RUNS) metaByRun.delete(metaByRun.keys().next().value as string);
}

export function councilRunMeta(correlationId: string): CouncilRunMeta | undefined {
  return metaByRun.get(correlationId);
}
