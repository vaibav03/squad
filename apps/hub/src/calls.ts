import type { ActiveCall, CallRegistry } from './types';

export function createCallRegistry(now: () => number = Date.now): CallRegistry {
  const calls = new Map<string, ActiveCall>();
  return {
    open(c) {
      const rec = { ...c, startedAt: now() };
      calls.set(c.callId, rec);
      return rec;
    },
    close(callId) {
      const c = calls.get(callId);
      calls.delete(callId);
      return c;
    },
    get: (id) => calls.get(id),
    byStudent: (s) => [...calls.values()].find((c) => c.student === s),
    active: () => [...calls.values()],
    clear: () => calls.clear(),
  };
}
