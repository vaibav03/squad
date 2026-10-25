import type { ActiveCall, CallRegistry } from './types';

export function createCallRegistry(now: () => number = Date.now): CallRegistry {
  const calls = new Map<string, ActiveCall>();
  const owners = new Map<string, string | null>();
  const note = (id: string, s: string | null) => {
    owners.set(id, s);
    if (owners.size > 2000) owners.delete(owners.keys().next().value as string);
  };
  return {
    open(c) {
      const rec = { ...c, startedAt: now() };
      calls.set(c.callId, rec);
      note(c.callId, c.student);
      return rec;
    },
    close(callId) {
      const c = calls.get(callId);
      calls.delete(callId);
      return c;
    },
    get: (id) => calls.get(id),
    noteOwner: note,
    ownerOf: (id) => owners.get(id),
    byStudent: (s) => [...calls.values()].find((c) => c.student === s),
    active: () => [...calls.values()],
    clear: () => {
      calls.clear();
      owners.clear();
    },
  };
}
