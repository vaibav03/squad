import type { AgentInfo, AgentState } from '../world/api';

export const STATE_LABEL: Record<AgentState, string> = {
  idle: 'resting',
  studying: 'studying',
  in_call: 'on a call',
  waiting_for_student: 'waiting for you',
};
/** Glyph that carries the state without colour (never colour alone). */
export const STATE_GLYPH: Record<AgentState, string> = {
  idle: 'z',
  studying: '*',
  in_call: '~',
  waiting_for_student: '!',
};

const KIND_ORDER: Record<AgentInfo['kind'], number> = {
  student: 0,
  dean: 1,
  council: 2,
  expert: 3,
  mediator: 4,
};
export function chipOrder(list: readonly AgentInfo[]): AgentInfo[] {
  return list
    .filter((a) => !a.hidden)
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        (x.a.state === 'waiting_for_student' ? -1 : 0) -
          (y.a.state === 'waiting_for_student' ? -1 : 0) ||
        KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind] ||
        x.i - y.i,
    )
    .map((x) => x.a);
}

export function formatClock(hours: number): string {
  const h24 = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
export const initialOf = (name: string) =>
  (name.replace(/^(the|chapter)\s+/i, '').trim()[0] ?? '?').toUpperCase();

const PORTRAIT_DIR = 'assets/pixel/composed/characters';
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/**
 * Pixel portrait (32x32 tile from the design-foundation cast) for an agent chip, by kind. Students alternate between
 * the two student sprites by a stable hash so neighbours read as different people; councils cycle the three seats.
 */
export function portraitFor(a: Pick<AgentInfo, 'id' | 'kind'>): string {
  const dir = (d: string) => `${PORTRAIT_DIR}/${d}/portrait.png`;
  switch (a.kind) {
    case 'student':
      return dir(hash(a.id) % 2 ? 'freshman' : 'student');
    case 'dean':
      return dir('dean');
    case 'mediator':
      return dir('mediator');
    case 'expert':
      return dir('expert');
    case 'council':
      return dir(['council-balance', 'council-chill', 'council-hard'][hash(a.id) % 3]!);
  }
}
