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
