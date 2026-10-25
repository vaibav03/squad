import type { AgentInfo, AgentState } from '../world/api';

export const STATE_LABEL: Record<AgentState, string> = {
  idle: 'resting',
  studying: 'studying',
  in_call: 'on a call',
  waiting_for_student: 'waiting for you',
};
/** Glyph that carries the state without colour (never colour alone). */
export const STATE_GLYPH: Record<AgentState, string> = { idle: 'z', studying: '*', in_call: '~', waiting_for_student: '!' };

const KIND_ORDER: Record<AgentInfo['kind'], number> = { student: 0, dean: 1, council: 2, expert: 3, mediator: 4 };
export function chipOrder(list: readonly AgentInfo[]): AgentInfo[] {
  return list
    .filter((a) => !a.hidden)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.state === 'waiting_for_student' ? -1 : 0) - (y.a.state === 'waiting_for_student' ? -1 : 0) || KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind] || x.i - y.i)
    .map((x) => x.a);
}

export function formatClock(hours: number): string {
  const h24 = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
export const initialOf = (name: string) => (name.replace(/^(the|chapter)\s+/i, '').trim()[0] ?? '?').toUpperCase();
