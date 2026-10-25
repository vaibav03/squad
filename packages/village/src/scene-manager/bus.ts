import type { AgentInfo, AgentRegistry, AgentState, Interactable, VillageBus, VillageBusEvents } from '../world/api';

export function createBus(): VillageBus {
  const subs = new Map<string, Set<(p: never) => void>>();
  return {
    on(k, fn) {
      let s = subs.get(k);
      if (!s) subs.set(k, (s = new Set()));
      s.add(fn as (p: never) => void);
      return () => s!.delete(fn as (p: never) => void);
    },
    emit<K extends keyof VillageBusEvents>(k: K, p: VillageBusEvents[K]) {
      for (const fn of [...(subs.get(k) ?? [])]) {
        try {
          (fn as (p: VillageBusEvents[K]) => void)(p);
        } catch (e) {
          console.error(`[village] bus handler for "${k}" threw`, e);
        }
      }
    },
  };
}

export function createAgentRegistry(bus: VillageBus): AgentRegistry & { onChange(fn: () => void): () => void } {
  const agents = new Map<string, AgentInfo>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((f) => f());
  return {
    register(info) {
      agents.set(info.id, { state: 'idle', ...info });
      changed();
    },
    setState(id, state: AgentState) {
      const a = agents.get(id);
      if (!a) {
        agents.set(id, { id, name: id, kind: 'expert', state, hidden: true });
      } else if (a.state === state) return;
      else a.state = state;
      bus.emit('agentState', { id, state });
      changed();
    },
    get: (id) => agents.get(id),
    list: () => [...agents.values()],
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function createInteractables() {
  const items = new Map<string, Interactable>();
  return {
    register(i: Interactable) {
      items.set(i.id, i);
      return () => {
        if (items.get(i.id) === i) items.delete(i.id);
      };
    },
    list: () => [...items.values()],
  };
}
