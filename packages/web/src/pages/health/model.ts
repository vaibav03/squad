import type { HealthCheck, HealthGroup, HealthReport, HealthStatus } from '@squad/core';
import { PHASE_LABEL, type ConnPhase } from '../../lib/connection-phase';
import { TRUTH_LABELS } from '../../lib/state-labels';

export const GROUP_TITLE: Record<HealthGroup, string> = {
  canvas: 'Canvas',
  google: 'Google Workspace',
  chain: 'Chain: context to chat, plan and trip',
  sendblue: 'iMessage (Sendblue)',
  platform: 'Platform',
};
export const GROUP_ORDER: HealthGroup[] = ['canvas', 'google', 'chain', 'sendblue', 'platform'];

export const STATUS_WORD: Record<HealthStatus, string> = {
  pass: 'Pass',
  warn: 'Warn',
  fail: 'Fail',
  blocked: 'BLOCKED',
};
export const STATUS_TONE: Record<HealthStatus, 'ok' | 'ember' | 'alert' | 'violet'> = {
  pass: 'ok',
  warn: 'ember',
  fail: 'alert',
  blocked: 'violet',
};

export function groupChecks(r: HealthReport): { group: HealthGroup; checks: HealthCheck[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    checks: r.checks.filter((c) => c.group === group),
  })).filter((g) => g.checks.length > 0);
}

/** The banner shows for any fail, or a warn on a core chain link (Canvas, Google, or the context chain). */
export function bannerChecks(r: HealthReport): HealthCheck[] {
  return r.checks.filter(
    (c) =>
      c.status === 'fail' ||
      (c.status === 'warn' && ['canvas', 'google', 'chain'].includes(c.group)),
  );
}

export const countByStatus = (r: HealthReport): Record<HealthStatus, number> => {
  const o: Record<HealthStatus, number> = { pass: 0, warn: 0, fail: 0, blocked: 0 };
  for (const c of r.checks) o[c.status]++;
  return o;
};

/* ---- Customer view: four plain groups built from the same checks ---- */

export type CustomerGroupId = 'canvas' | 'google' | 'answers' | 'messaging';
export type CustomerTone = 'ok' | 'neutral' | 'ember' | 'alert' | 'violet';
export interface CustomerGroup {
  id: CustomerGroupId;
  title: string;
  /** State label from lib/connection-phase.ts or lib/state-labels.ts. */
  label: string;
  tone: CustomerTone;
  /** True when the customer should do something. */
  needsAttention: boolean;
  /** One plain sentence: no check ids, env names or origins. */
  sentence: string;
  /** Button text; absent when nothing needs doing. */
  fixLabel: string | null;
  /** Where the fix button goes: an anchor on this page or a route. */
  fixTo: string;
}

const TITLE: Record<CustomerGroupId, string> = {
  canvas: 'Canvas',
  google: 'Google',
  answers: 'Cubbie answers',
  messaging: 'Messaging (iMessage with Sendblue)',
};
const rank: Record<HealthStatus, number> = { pass: 0, warn: 1, blocked: 2, fail: 3 };
const worst = (cs: HealthCheck[]): HealthCheck | null =>
  cs.reduce<HealthCheck | null>((a, c) => (!a || rank[c.status] > rank[a.status] ? c : a), null);

/** The checks that belong to each customer group. Plan and trip checks stay in the technical details. */
export function customerChecks(r: HealthReport, id: CustomerGroupId): HealthCheck[] {
  return r.checks.filter((c) => {
    if (id === 'canvas') return c.group === 'canvas';
    if (id === 'google') return c.group === 'google';
    if (id === 'messaging') return c.group === 'sendblue' || c.id === 'imessage_bridge';
    return ['cubbie_reachable', 'model_provider', 'items_visible', 'context_retrievable'].includes(
      c.id,
    );
  });
}

const CONN_COPY: Record<'canvas' | 'google', Record<ConnPhase, [string, string | null]>> = {
  canvas: {
    not_connected: [
      'Canvas is not connected yet, so Cubbie cannot see your assignments.',
      'Connect Canvas',
    ],
    connecting: ['Canvas is connecting.', null],
    syncing: ['Canvas is importing your items.', null],
    live: ['Canvas is connected and importing from your own account.', null],
    demo: ['Canvas shows demo data: example items, not your account.', 'Connect my own Canvas'],
    degraded: [
      'Canvas is having trouble. Cubbie is using the last items we imported.',
      'Check Canvas',
    ],
    reauth: ['Canvas needs you to sign in again.', 'Sign in to Canvas again'],
  },
  google: {
    not_connected: [
      'Google is not connected yet, so Cubbie cannot see your calendar or Classroom.',
      'Connect Google',
    ],
    connecting: ['Google is connecting.', null],
    syncing: ['Google is importing your items.', null],
    live: ['Google is connected and importing from your own account.', null],
    demo: ['Google shows demo data: example items, not your account.', 'Connect my own Google'],
    degraded: [
      'Google is having trouble. Cubbie is using the last items we imported.',
      'Check Google',
    ],
    reauth: ['Google needs you to sign in again.', 'Sign in to Google again'],
  },
};

function connPhase(checks: HealthCheck[]): ConnPhase {
  const w = worst(checks);
  if (!w) return 'not_connected';
  const connected = checks.find((c) => c.id.endsWith('_connected'));
  const mode = connected?.mode ?? w.mode ?? '';
  if (mode === 'expired') return 'reauth';
  if (connected?.status === 'warn' && /not connected|not detected|no canvas/.test(mode))
    return 'not_connected';
  if (connected?.status === 'blocked' || connected?.mode === 'not connected')
    return 'not_connected';
  const fixture = checks.some((c) => c.mode === 'fixture');
  if (fixture && w.status !== 'fail') return 'demo';
  if (w.status === 'fail' || w.status === 'warn') return 'degraded';
  return 'live';
}

/** True when the Google sign-in cannot be used on this server (so the demo workspace is the way in). */
export function googleNeedsDemo(r: HealthReport | null): boolean {
  const c = r?.checks.find((x) => x.id === 'google_connected');
  return !!c?.missingEnv?.length;
}

export function customerGroups(r: HealthReport): CustomerGroup[] {
  const out: CustomerGroup[] = [];
  for (const id of ['canvas', 'google'] as const) {
    const phase = connPhase(customerChecks(r, id));
    const [sentence, fixLabel] = CONN_COPY[id][phase];
    out.push({
      id,
      title: TITLE[id],
      label: PHASE_LABEL[phase],
      tone:
        phase === 'live'
          ? 'ok'
          : phase === 'demo'
            ? 'violet'
            : phase === 'syncing' || phase === 'connecting'
              ? 'neutral'
              : phase === 'not_connected'
                ? 'ember'
                : 'alert',
      needsAttention:
        phase !== 'live' && phase !== 'demo' && phase !== 'syncing' && phase !== 'connecting',
      sentence,
      fixLabel,
      fixTo: `#${id}`,
    });
  }
  // Cubbie answers: the model and the imported context it reads.
  {
    const cs = customerChecks(r, 'answers');
    const w = worst(cs);
    const model = cs.find((c) => c.id === 'model_provider');
    const practice = model?.mode === 'fixture';
    const bad = w && (w.status === 'fail' || w.status === 'warn') && !(w === model && practice);
    const noContext = cs.some(
      (c) => ['items_visible', 'context_retrievable'].includes(c.id) && c.status !== 'pass',
    );
    const modelBad = cs.some(
      (c) =>
        ['cubbie_reachable', 'model_provider'].includes(c.id) &&
        (c.status === 'fail' || (c.status === 'warn' && c.mode !== 'fixture')),
    );
    out.push({
      id: 'answers',
      title: TITLE.answers,
      label: modelBad
        ? PHASE_LABEL.degraded
        : practice
          ? TRUTH_LABELS.practice.short
          : bad
            ? PHASE_LABEL.degraded
            : TRUTH_LABELS.live.short,
      tone: modelBad ? 'alert' : practice ? 'violet' : bad ? 'ember' : 'ok',
      needsAttention: modelBad || !!bad,
      sentence: modelBad
        ? 'Cubbie could not reach its answer service just now.'
        : noContext
          ? 'Cubbie answers, but there is nothing imported for it to read yet.'
          : practice
            ? 'Cubbie is giving practice answers: example text, not real AI.'
            : 'Cubbie answers from the items you imported.',
      fixLabel: modelBad ? 'Try again' : noContext ? 'Review imported items' : null,
      fixTo: modelBad ? '#health' : '#imported',
    });
  }
  {
    const cs = customerChecks(r, 'messaging');
    const w = worst(cs);
    const fixture = cs.some((c) => c.mode === 'fixture' || c.mode === 'dry_run');
    const down = cs.some((c) => c.status === 'fail');
    const notSet =
      !w ||
      cs.every((c) => c.status === 'blocked' || /not connected|not installed/.test(c.mode ?? ''));
    out.push({
      id: 'messaging',
      title: TITLE.messaging,
      label: down
        ? PHASE_LABEL.degraded
        : notSet
          ? TRUTH_LABELS.notset.short
          : fixture
            ? PHASE_LABEL.demo
            : TRUTH_LABELS.live.short,
      tone: down ? 'alert' : notSet ? 'ember' : fixture ? 'violet' : 'ok',
      needsAttention: down || notSet,
      sentence: down
        ? 'Messages are not getting through right now. Chat still works on the web.'
        : notSet
          ? 'Texting Cubbie is not set up yet. Chat still works on the web.'
          : fixture
            ? 'Messaging is in demo mode: no real texts are sent.'
            : 'Texting Cubbie works.',
      fixLabel: down ? 'Check messaging' : notSet ? 'Set up messaging' : null,
      fixTo: '#messaging',
    });
  }
  return out;
}

export function headline(groups: CustomerGroup[]): { text: string; n: number } {
  const n = groups.filter((g) => g.needsAttention).length;
  return {
    n,
    text:
      n === 0
        ? 'Everything works'
        : `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  };
}
