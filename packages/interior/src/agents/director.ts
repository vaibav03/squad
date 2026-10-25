/**
 * Maps VillageEvents onto interior actions. Pure: no Phaser, no timers. The scene executes the commands.
 * Candidate to share with the village adapter (packages/village adapter produces SceneCommands from the
 * same events); kept separate here because the verbs differ (rooms and doors instead of x positions).
 */
import type { VillageEvent } from '@squad/core';

export type Goal =
  | { kind: 'waypoint'; name: string }
  | { kind: 'room'; room: string; prefer?: string }
  | { kind: 'door'; door: string; side: 'a' | 'b' };

export type Command =
  | { type: 'ensure'; agent: string }
  | { type: 'goto'; agent: string; goal: Goal }
  | { type: 'lock'; door: string; locked: boolean }
  | { type: 'marker'; agent: string; marker: 'waiting' | 'check' | 'alert' | 'none' }
  | { type: 'gather'; room: string }
  | { type: 'announce'; text: string };

export interface DirectorConfig {
  /** Door that guards the council room; locked until the council convenes. */
  councilDoor: string;
}

export const DEFAULT_DIRECTOR: DirectorConfig = { councilDoor: 'door-commons-council' };

const agentLabel = (id: string) =>
  id.replace(/^(student|expert|council):/, '').replace(/[-_]/g, ' ');

/** Seat index for council members, stable per member name. */
export function seatFor(member: string, seats: number): number {
  let h = 0;
  for (const c of member) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % seats) + 1;
}

export function direct(e: VillageEvent, cfg: DirectorConfig = DEFAULT_DIRECTOR): Command[] {
  switch (e.t) {
    case 'agent.state': {
      const out: Command[] = [{ type: 'ensure', agent: e.agent }];
      switch (e.state) {
        case 'idle':
          out.push({ type: 'goto', agent: e.agent, goal: { kind: 'room', room: 'commons' } });
          out.push({ type: 'marker', agent: e.agent, marker: 'none' });
          break;
        case 'studying':
          out.push({
            type: 'goto',
            agent: e.agent,
            goal: { kind: 'room', room: 'library', prefer: 'library.aisle' },
          });
          out.push({ type: 'marker', agent: e.agent, marker: 'none' });
          break;
        case 'in_call':
          out.push({
            type: 'goto',
            agent: e.agent,
            goal: { kind: 'waypoint', name: 'commons.hearth' },
          });
          break;
        case 'waiting_for_student':
          out.push({
            type: 'goto',
            agent: e.agent,
            goal: { kind: 'door', door: cfg.councilDoor, side: 'a' },
          });
          out.push({ type: 'marker', agent: e.agent, marker: 'waiting' });
          break;
      }
      out.push({
        type: 'announce',
        text: `${agentLabel(e.agent)} is ${e.state.replace(/_/g, ' ')}.`,
      });
      return out;
    }
    case 'agent.message': {
      const out: Command[] = [{ type: 'ensure', agent: e.from }];
      out.push({
        type: 'goto',
        agent: e.from,
        goal: { kind: 'waypoint', name: 'commons.center' },
      });
      if (e.to !== 'commons') {
        out.push({ type: 'ensure', agent: e.to });
        out.push({ type: 'goto', agent: e.to, goal: { kind: 'waypoint', name: 'commons.hearth' } });
      }
      if (e.kind === 'conflict') out.push({ type: 'marker', agent: e.from, marker: 'alert' });
      return out;
    }
    case 'confirm.pending':
      return [
        { type: 'ensure', agent: `student:${e.student}` },
        {
          type: 'goto',
          agent: `student:${e.student}`,
          goal: { kind: 'door', door: cfg.councilDoor, side: 'a' },
        },
        { type: 'marker', agent: `student:${e.student}`, marker: 'waiting' },
      ];
    case 'confirm.done':
      return [
        { type: 'marker', agent: `student:${e.student}`, marker: 'check' },
        { type: 'lock', door: cfg.councilDoor, locked: false },
      ];
    case 'council.opinion':
    case 'council.rank':
    case 'council.verdict': {
      const out: Command[] = [{ type: 'lock', door: cfg.councilDoor, locked: false }];
      if (e.t === 'council.opinion') {
        out.push({ type: 'ensure', agent: e.member });
        out.push({
          type: 'goto',
          agent: e.member,
          goal: { kind: 'waypoint', name: `council.seat-${seatFor(e.member, 5)}` },
        });
        if (e.dissent) out.push({ type: 'marker', agent: e.member, marker: 'alert' });
      }
      if (e.t === 'council.verdict' && e.dissenter)
        out.push({ type: 'marker', agent: e.dissenter, marker: 'alert' });
      return out;
    }
    case 'quiz.question': {
      const who = e.target ? `student:${e.target}` : undefined;
      return who
        ? [
            { type: 'ensure', agent: who },
            {
              type: 'goto',
              agent: who,
              goal: { kind: 'room', room: 'classroom', prefer: 'classroom.desk' },
            },
          ]
        : [];
    }
    case 'call.start':
      return [
        { type: 'ensure', agent: e.agent },
        { type: 'goto', agent: e.agent, goal: { kind: 'waypoint', name: 'commons.hearth' } },
      ];
    case 'trip.confirmed':
      return [
        { type: 'announce', text: 'The trip is confirmed. Everyone gathers in the commons.' },
      ];
    default:
      return [];
  }
}
