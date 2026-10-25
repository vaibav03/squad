import type { Place, SceneCommand } from '../adapter';

/**
 * Camera director: decides WHERE the camera should look, from the same SceneCommands the adapter emits.
 * World-agnostic: it speaks in Places (agent ids, chapters, councils, commons, board), never pixels, so a
 * side-view world and a top-down world can both bind it (the world resolves a Place to its own coordinates).
 *
 * Policy (docs/design motion spec: camera pan is the 400 ms ease-in-out preset move):
 *  - an event that concerns a place proposes that place; proposals in a short burst are merged and the most
 *    meaningful one wins (alerts > captions > messages > walking);
 *  - at most one move per MIN_GAP_MS, so a flurry of events reads as a few calm cuts, not a shaken camera;
 *  - never fights the viewer: any manual camera input (key, drag, tap-to-walk, HUD camera button) silences the
 *    director for MANUAL_QUIET_MS (5 s) and drops what it had queued;
 *  - Calm mode: the shot is a jump cut (`jump: true`); the world performs it without the 400 ms ease;
 *  - when nothing has happened for RELEASE_IDLE_MS the camera is released back to the player.
 */
export type FocusTarget = Place | { readonly kind: 'agent'; readonly agent: string };

export interface Shot {
  readonly action: 'shot';
  readonly target: FocusTarget;
  readonly key: string;
  readonly score: number;
  readonly reason: string;
  readonly jump: boolean;
  /** Camera holds on the target until the next shot or release (the world should not auto-return). */
  readonly holdMs: number;
}
export interface Release {
  readonly action: 'release';
}
export type DirectorAction = Shot | Release;

export const MANUAL_QUIET_MS = 5000;
export const MIN_GAP_MS = 1800;
export const BURST_MS = 120;
export const CANDIDATE_TTL_MS = 2500;
export const RELEASE_IDLE_MS = 9000;
export const HOLD_FOREVER_MS = 600_000;

const door = (agent: string): Place => ({ kind: 'door', agent });
const isMediator = (agent: string): boolean => agent === 'mediator';

export interface Proposal {
  target: FocusTarget;
  score: number;
  reason: string;
}

/** What a command is about and how much it matters. Pure; `null` = the camera has no business with it. */
export function proposalFor(cmd: SceneCommand): Proposal | null {
  switch (cmd.type) {
    case 'marker':
      return { target: cmd.at, score: 8, reason: `marker:${cmd.reason}` };
    case 'showBubble': {
      const loud = cmd.dissent || cmd.tone === 'alert';
      const score = loud ? 8 : cmd.style === 'caption' ? 7 : cmd.style === 'announce' ? 2 : 5;
      return { target: cmd.at, score, reason: `bubble:${cmd.style}` };
    }
    case 'ring':
      return cmd.on && !isMediator(cmd.agent)
        ? { target: door(cmd.agent), score: 6, reason: 'waiting for a yes' }
        : null;
    case 'spawnEnvelope':
      return isMediator(cmd.from)
        ? null
        : { target: door(cmd.from), score: 3, reason: `envelope:${cmd.kind}` };
    case 'walkTo':
      return { target: cmd.to, score: 4, reason: 'walk' };
    case 'tick':
      return { target: cmd.at, score: 3, reason: 'confirmed' };
    case 'ledgerCard':
      return {
        target: { kind: 'board' },
        score: cmd.card.kind === 'blocked' ? 6 : 5,
        reason: `ledger:${cmd.card.kind}`,
      };
    case 'chalkboard':
      return {
        target: { kind: 'house', chapter: cmd.chapter },
        score: cmd.mine ? 7 : 5,
        reason: `quiz:${cmd.mark}`,
      };
    case 'setGlow':
      return { target: { kind: 'house', chapter: cmd.chapter }, score: 2, reason: 'mastery' };
    case 'callPortrait':
      return cmd.on ? { target: door(cmd.agent), score: 6, reason: 'call' } : null;
    case 'setAgentState':
      return cmd.state === 'in_call' && !isMediator(cmd.agent)
        ? { target: door(cmd.agent), score: 4, reason: 'call' }
        : null;
    case 'councilOpinion':
      return { target: { kind: 'hall', councilId: cmd.councilId }, score: 6, reason: 'council' };
    case 'councilRank':
      return { target: { kind: 'hall', councilId: cmd.councilId }, score: 6, reason: 'council' };
    case 'councilVerdict':
      return { target: { kind: 'hall', councilId: cmd.councilId }, score: 7, reason: 'verdict' };
    case 'lantern':
      return { target: { kind: 'hall', councilId: cmd.councilId }, score: 5, reason: 'lantern' };
    default:
      // openOverlay (DOM covers the canvas), playTrip (the cutscene owns the camera), announce, dismissBubble, ...
      return null;
  }
}

export function targetKey(t: FocusTarget): string {
  switch (t.kind) {
    case 'door':
      return `door:${t.agent}`;
    case 'agent':
      return `agent:${t.agent}`;
    case 'house':
      return `house:${t.chapter}`;
    case 'hall':
      return `hall:${t.councilId}`;
    default:
      return t.kind;
  }
}

interface Candidate extends Proposal {
  at: number;
  seq: number;
}

export interface Director {
  /** Feed every SceneCommand the adapter emitted. */
  observe(cmd: SceneCommand, now: number): void;
  /** Call every frame (or at least every ~100 ms). Returns what the camera should do now, if anything. */
  tick(now: number): DirectorAction | null;
  /** The viewer touched the camera (key, drag, tap-to-walk, camera button). */
  userInput(now: number): void;
  /** Key of the target the camera was last sent to. */
  readonly current: string | null;
  readonly quietUntil: number;
}

export function createDirector(opts: { calm: () => boolean }): Director {
  let cands: Candidate[] = [];
  let seq = 0;
  let lastShotAt = -Infinity;
  let lastActivityAt = -Infinity;
  let firstPendingAt = Infinity;
  let quietUntil = -Infinity;
  let current: string | null = null;

  return {
    get current() {
      return current;
    },
    get quietUntil() {
      return quietUntil;
    },
    observe(cmd, now) {
      if (now < quietUntil) return;
      const p = proposalFor(cmd);
      if (!p) return;
      if (cands.length === 0) firstPendingAt = now;
      cands.push({ ...p, at: now, seq: seq++ });
      lastActivityAt = now;
    },
    userInput(now) {
      quietUntil = now + MANUAL_QUIET_MS;
      cands = [];
      firstPendingAt = Infinity;
      current = null; // the camera is wherever the viewer left it
    },
    tick(now) {
      if (now < quietUntil) return null;
      cands = cands.filter((c) => now - c.at <= CANDIDATE_TTL_MS);
      if (cands.length === 0) {
        firstPendingAt = Infinity;
        if (current !== null && now - lastActivityAt >= RELEASE_IDLE_MS) {
          current = null;
          return { action: 'release' };
        }
        return null;
      }
      if (now - firstPendingAt < BURST_MS || now - lastShotAt < MIN_GAP_MS) return null;
      let best = cands[0]!;
      for (const c of cands)
        if (c.score > best.score || (c.score === best.score && c.seq > best.seq)) best = c;
      cands = [];
      firstPendingAt = Infinity;
      const key = targetKey(best.target);
      if (key === current) return null; // already looking at it
      current = key;
      lastShotAt = now;
      return {
        action: 'shot',
        target: best.target,
        key,
        score: best.score,
        reason: best.reason,
        jump: opts.calm(),
        holdMs: HOLD_FOREVER_MS,
      };
    },
  };
}
