import type { CouncilRunRecord } from '@squad/core';
import { lastRunLabel, runsFor, useLastRunsState, type LastRunsState } from './store';

export interface AgentNote {
  rec: CouncilRunRecord;
  /** 'Last council, 4 min ago, Live' */
  label: string;
  /** What this agent publicly said in that run (summary, then stance), when it said anything. */
  said?: string;
  stance?: string;
}

export const NO_COUNCIL_YET = 'Not part of a council run yet';

const tail = (id: string): string => id.replace(/^council:/, '');

/**
 * Pure: the last stored run that this council agent took part in (an agent id, a voice key like `skeptic`, or the
 * room-level `council:ask`), with its last public words. Public text only, never reasoning.
 */
export function agentNoteFrom(
  s: Pick<LastRunsState, 'runs'>,
  agent: string,
  now: number,
): AgentNote | undefined {
  const a = agent.toLowerCase();
  for (const rec of s.runs) {
    const room = `council:${rec.councilKey}`;
    const mine = rec.agents.find(
      (x) =>
        x.id === agent ||
        x.displayName.toLowerCase() === a ||
        x.id.endsWith(`-${a}`) ||
        tail(x.id) === a,
    );
    if (!mine && agent !== room && !(agent === 'council:council') && !a.startsWith('council:live-'))
      continue;
    const id = mine?.id;
    const msgs = id ? rec.messages.filter((m) => m.from === id && (m.summary || m.stance)) : [];
    const last = msgs.at(-1);
    return {
      rec,
      label: lastRunLabel(rec, now),
      ...(last?.summary ? { said: last.summary } : {}),
      ...(last?.stance ? { stance: last.stance } : {}),
    };
  }
  return undefined;
}

export function useAgentNote(agent: string | undefined, keys?: readonly string[]): AgentNote | undefined {
  const s = useLastRunsState();
  if (!agent) return undefined;
  return agentNoteFrom(keys ? { runs: runsFor(s, keys) } : s, agent, Date.now());
}
