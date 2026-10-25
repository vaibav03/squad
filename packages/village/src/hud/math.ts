import type { AgentInfo, AgentState } from '../world/api';

export const STATE_LABEL: Record<AgentState, string> = {
  idle: 'resting',
  studying: 'studying',
  in_call: 'on a call',
  waiting_for_student: 'waiting for you',
};
/** The status word on a HUD chip (always shown with an icon, never colour, a dot or a letter alone). */
export const STATUS_WORD: Record<AgentState, string> = {
  idle: 'Idle',
  studying: 'Working',
  in_call: 'On a call',
  waiting_for_student: 'Waiting on you',
};
/** One plain sentence on what each kind of agent does (tooltip and the hint line under the rail title). */
export const KIND_BLURB: Record<AgentInfo['kind'], string> = {
  student: 'Studies for a classmate and shares only its public activity.',
  expert: 'Knows one chapter by heart and answers questions about it.',
  dean: 'Keeps the squad organised and knows everyone.',
  mediator: 'Keeps trades between study agents fair and private.',
  council: 'Sits on the council: weighs answers, ranks them and helps decide.',
};
/** Accessible name of a rail button: 'Tutor, idle: open'. */
export const chipName = (name: string, state: AgentState): string =>
  `${name}, ${STATUS_WORD[state].toLowerCase()}: open`;
export const KIND_ROLE: Record<AgentInfo['kind'], string> = {
  student: 'Student',
  dean: 'Dean',
  council: 'Council member',
  expert: 'Chapter expert',
  mediator: 'Mediator',
};

/** Cast portrait file (assets/pixel/composed/characters/<key>/portrait.png) for an agent: distinct per role, never initials. */
export function portraitKeyFor(a: Pick<AgentInfo, 'id' | 'kind'>, me?: string): string {
  switch (a.kind) {
    case 'student':
      return me && a.id === `student:${me}` ? 'student' : 'freshman';
    case 'dean':
      return 'dean';
    case 'mediator':
      return 'mediator';
    case 'expert':
      return 'expert';
    default: {
      const id = a.id.toLowerCase();
      if (/chair/.test(id)) return 'chairman';
      if (/chill|skeptic/.test(id)) return 'council-chill';
      if (/grind|practitioner|solver/.test(id)) return 'council-hard';
      return 'council-balance';
    }
  }
}
export const portraitPath = (key: string): string =>
  `assets/pixel/composed/characters/${key}/portrait.png`;

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

/** A HUD popover: a panel toggled through `data-open` plus the button that controls it. */
export interface HudPopover {
  panel: { dataset: Record<string, string | undefined> };
  button: { setAttribute(name: string, value: string): void };
}

/** Closes every open popover; returns true when at least one was open (the Escape was consumed). */
export function closePopovers(pops: HudPopover[]): boolean {
  let closed = false;
  for (const p of pops) {
    if (p.panel.dataset.open === 'true') {
      p.panel.dataset.open = 'false';
      p.button.setAttribute('aria-expanded', 'false');
      closed = true;
    }
  }
  return closed;
}
