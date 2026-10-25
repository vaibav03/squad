/**
 * SceneCommand: the contract between the pure adapter and the scenes (docs/village-events.md).
 * Scenes execute commands and hold no business state. Commands carry only display-safe strings:
 * labels, plain-language kinds and text that the event contract already marks as shareable.
 * Nothing here is ever derived from a withheld value.
 */

/** Anything that can be addressed in the world. Scenes resolve a Place to pixel coordinates. */
export type Place =
  | { readonly kind: 'door'; readonly agent: string } // front door of an agent's house (student:, expert:, dean)
  | { readonly kind: 'commons' } // campfire in the middle of the neighbourhood
  | { readonly kind: 'board' } // notice board (disclosure ledger)
  | { readonly kind: 'house'; readonly chapter: string } // chapter house
  | { readonly kind: 'hall'; readonly councilId: string } // Council Hall
  | { readonly kind: 'tripDoor' }; // HUD Trip door, appears after the cutscene

export type AgentState = 'idle' | 'studying' | 'in_call' | 'waiting_for_student';
export type AlertReason = 'conflict' | 'option_dropped' | 'query_denied' | 'blocked';
export type BubbleStyle = 'speech' | 'thought' | 'caption' | 'announce';

export type LedgerCard =
  | { readonly kind: 'shared'; readonly field: string; readonly shared: string }
  | { readonly kind: 'hidden'; readonly field: string } // label + padlock + "hidden"
  | { readonly kind: 'blocked'; readonly field: string }; // red stop + "blocked by privacy gate"

export type OverlayRequest =
  | { readonly overlay: 'openCall'; readonly agent: string; readonly callId: string }
  | { readonly overlay: 'openQuiz'; readonly quizId: string; readonly chapter: string }
  | { readonly overlay: 'openLedger'; readonly taskId: string }
  | { readonly overlay: 'openConfirm'; readonly taskId: string; readonly question: string }
  | {
      readonly overlay: 'close';
      readonly which: 'call' | 'confirm';
      readonly callId?: string;
      readonly taskId?: string;
    };

export type SceneCommand =
  /** Window lit / dim, desk lamp, NPC typing, "on a call" sign. */
  | { readonly type: 'setAgentState'; readonly agent: string; readonly state: AgentState }
  | {
      readonly type: 'walkTo';
      readonly agent: string;
      readonly to: Place;
      readonly carrying?: string;
    }
  /** Envelope pops at `from`'s door, travels to `to` (carried), hand-off glides to the receiver. */
  | {
      readonly type: 'spawnEnvelope';
      readonly id: string;
      readonly from: string;
      readonly to: string | 'commons';
      readonly taskId: string;
      readonly kind: string;
    }
  | {
      readonly type: 'showBubble';
      readonly key: string; // replaces an existing bubble with the same key
      readonly at: Place | { readonly kind: 'agent'; readonly agent: string };
      readonly style: BubbleStyle;
      readonly text: string;
      readonly lines?: readonly string[]; // shared[] labels, one per line
      readonly minMs: number; // dwell: >= 1200 ms per 20 chars
      readonly dissent?: boolean; // red-lined dissenter bubble that stays
      readonly tone?: 'alert'; // red accent (conflict, dropped option, denied request)
    }
  | { readonly type: 'dismissBubble'; readonly key: string }
  /** Red "!" alert. `at` is the commons for mediator vetoes, a door for gate blocks. */
  | {
      readonly type: 'marker';
      readonly at: Place;
      readonly reason: AlertReason;
      readonly key: string;
    }
  | { readonly type: 'clearMarker'; readonly key: string }
  /** Pulsing ring at a door while waiting for the student's yes. */
  | { readonly type: 'ring'; readonly agent: string; readonly on: boolean }
  | { readonly type: 'tick'; readonly at: Place } // small check mark after confirm.done
  | {
      readonly type: 'ledgerCard';
      readonly taskId: string;
      readonly student: string;
      readonly card: LedgerCard;
    }
  | { readonly type: 'setGlow'; readonly chapter: string; readonly box: number }
  | {
      readonly type: 'chalkboard';
      readonly chapter: string;
      readonly mark: 'question' | 'tick' | 'cross' | 'none';
      /** True when the event is about the viewer (target of the question, or the answering student). */
      readonly mine?: boolean;
    }
  | {
      readonly type: 'callPortrait';
      readonly agent: string;
      readonly on: boolean;
      readonly student?: string;
    }
  | {
      readonly type: 'councilOpinion';
      readonly councilId: string;
      readonly member: string;
      readonly text: string;
    }
  | {
      readonly type: 'councilRank';
      readonly councilId: string;
      readonly member: string;
      readonly order: readonly string[];
    }
  | {
      readonly type: 'councilVerdict';
      readonly councilId: string;
      readonly member: string;
      readonly text: string;
      readonly dissenter?: string;
    }
  | { readonly type: 'lantern'; readonly councilId: string; readonly flicker: boolean }
  | { readonly type: 'openOverlay'; readonly request: OverlayRequest }
  | { readonly type: 'playTrip'; readonly taskId: string; readonly squadId: string }
  /** Polite live-region text for the a11y feed ("Council verdict: start with chapter 5"). */
  | {
      readonly type: 'announce';
      readonly text: string;
      readonly politeness: 'polite' | 'assertive';
    };

export type SceneCommandType = SceneCommand['type'];

/** Who is looking: overlays open only for this student. */
export interface AdapterContext {
  readonly me: string; // StudentId, ReplayScript.cast.me
  /** Squad size when known; under 3 the village hides counts and aggregates (no aggregate commands exist today). */
  readonly squadSize?: number;
}
