import { parseAgentId, type VillageEvent } from '@squad/core';
import type { HubDeps, LoggedEvent, Snapshot, SquadState, Viewer } from '../types';

type AgentState = Snapshot['agents'][string];

export function createSquadState(deps: HubDeps): SquadState {
  const agents = new Map<string, AgentState>();
  const pending = new Map<string, { student: string; taskId: string; question: string }>();

  const studentOfAgent = (id: string): string | undefined => {
    const a = parseAgentId(id);
    return a.kind === 'student' ? a.ref : undefined;
  };

  return {
    apply(e: LoggedEvent) {
      if (e.kind !== 'village') return;
      const ev = e.payload as VillageEvent;
      if (ev.t === 'agent.state') agents.set(ev.agent, ev.state);
      else if (ev.t === 'confirm.pending') pending.set(`${ev.student}|${ev.taskId}`, ev);
      else if (ev.t === 'confirm.done') pending.delete(`${ev.student}|${ev.taskId}`);
    },

    async snapshot(viewer: Viewer): Promise<Snapshot> {
      // Capture seq and every piece of in-memory state synchronously, before any await, so that
      // resuming the stream from `seq` loses nothing.
      const seq = deps.events.lastSeq();
      const now = deps.now();
      const dir = deps.directory;
      const me = dir.student(viewer.studentId);
      const squad = dir.squad(viewer.squadId);
      const pub = (s: { id: string; name: string; avatarUrl?: string; personaId?: string }) => ({
        id: s.id,
        name: s.name,
        ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
        ...(s.personaId ? { personaId: s.personaId } : {}),
      });
      const agentMap: Snapshot['agents'] = {};
      for (const [id, st] of agents) {
        const s = studentOfAgent(id);
        if (s === undefined || dir.squadOf(s) === viewer.squadId) agentMap[id] = st;
      }
      const pendingConfirms = [...pending.values()]
        .filter((p) => p.student === viewer.studentId)
        .map((p) => ({ taskId: p.taskId, question: p.question }));
      const trips = deps.trips.list(viewer.squadId).map((t) => ({
        tripId: t.tripId,
        taskId: t.taskId,
        status: t.status,
        confirmations: t.confirmations.map((c) => ({ student: c.student, confirmed: c.confirmed })),
      }));
      const calls = deps.calls
        .active()
        .filter((c) => c.squadId === viewer.squadId)
        .map((c) => ({ callId: c.callId, agent: c.agent, mine: c.student === viewer.studentId }));
      const settings = dir.settings(viewer.squadId);
      const members = dir.members(viewer.squadId).map(pub);
      const memberCount = dir.visibleMemberCount(viewer.squadId);

      const quizzes = await deps.ports.quiz.listOpen(viewer.studentId);
      return {
        seq,
        now,
        me: me ? pub(me) : { id: viewer.studentId, name: viewer.studentId },
        squad: { id: viewer.squadId, name: squad?.name ?? viewer.squadId, members, memberCount },
        agents: agentMap,
        pendingConfirms,
        trips,
        calls,
        quizzes,
        settings,
        projector: viewer.projector,
      };
    },

    reset() {
      agents.clear();
      pending.clear();
    },
  };
}
