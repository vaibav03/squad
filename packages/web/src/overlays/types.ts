// Public prop contracts for the shared overlays. Plain props in, plain callbacks out:
// no hub client, no Phaser, no router. The village (or any host) owns data fetching and
// mounts these over its stage. Documented in docs/overlays-api.md.
import type { AgentId, Citation, StudentId } from '@squad/core';

/** Props every overlay shares. */
export interface OverlayBaseProps {
  /** Controls mount and the enter/exit transition. Keep the element mounted while `open` flips. */
  open: boolean;
  /** Esc, scrim click, close button. Host decides what that means (see each overlay). */
  onClose: () => void;
  /** Focus goes here when the overlay closes (the canvas or the AgentList button). */
  returnFocusTo?: HTMLElement | null;
  /** Calm mode from the village HUD; forces the reduced-motion variants. */
  calm?: boolean;
  /** Cover the whole viewport (pages) instead of the nearest positioned ancestor. Default false. */
  fixed?: boolean;
}

// ---------------------------------------------------------------- Call panel

export interface CallAgent {
  id: AgentId; // 'expert:ch5', 'dean', ...
  name: string; // "Ch5 Expert"
  role: string; // "Chapter expert", shown under the name
  /** Fluent portrait url (UI chrome); falls back to `emoji` then initials. */
  portrait?: string;
  emoji?: string;
}

export type CallStatus = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface CallCaption {
  /** Stable key; a caption appears whole, never typed out. */
  id: string;
  speaker: 'agent' | 'you';
  text: string;
  cite?: Citation;
}

export interface CallPanelProps extends OverlayBaseProps {
  agent: CallAgent;
  status: CallStatus;
  /** Oldest first. The panel keeps the newest in view and announces them politely. */
  captions: CallCaption[];
  /** Who is making sound right now. Drives the portrait glow and the waveform colour. */
  speaking: 'agent' | 'you' | 'none';
  /** 0..1 smoothed amplitude of whoever is speaking. Optional: without it the waveform shows a calm static baseline. */
  level?: number;
  muted: boolean;
  onMuteChange: (muted: boolean) => void;
  handRaised: boolean;
  onHandRaiseChange: (raised: boolean) => void;
  /** Ends the call. The only action that hangs up. */
  onLeave: () => void;
  /** Click a citation chip. Optional; chips are plain labels without it. */
  onOpenCitation?: (cite: Citation) => void;
  /** Wall-clock ms since `call.start`, for the timer. */
  elapsedMs?: number;
  /** Shown when status is 'error' or 'reconnecting'. */
  message?: string;
  onRetry?: () => void;
}

// ---------------------------------------------------------------- Quiz card

export interface QuizChoice {
  id: string;
  label: string;
}

export interface QuizPayload {
  quizId: string;
  /** "Ch5" or "Chapter 5". */
  chapter: string;
  /** Optional position text such as "Q2". */
  label?: string;
  /** 1-based position and quiz length: renders "Q2 of 5" and the progress pills (never a score). */
  index?: number;
  total?: number;
  question: string;
  /** Absent means free text. */
  choices?: QuizChoice[];
}

export type QuizPhase =
  | 'loading' // payload still arriving (skeleton)
  | 'answering'
  | 'submitting'
  | 'done' // result is present
  | 'error'; // load or submit failed; `message` + `onRetry`

export interface QuizResult {
  /** Always true when a result exists. */
  recorded: true;
  /** Present only when the squad setting allows. Absent renders "Answer recorded". */
  correct?: boolean;
  explanation?: string;
}

export interface QuizAnswer {
  choice?: string;
  text?: string;
}

export interface QuizCardProps extends OverlayBaseProps {
  phase: QuizPhase;
  /** Absent only while `phase === 'loading'` or when load failed. */
  quiz?: QuizPayload;
  result?: QuizResult;
  message?: string;
  onSubmit: (answer: QuizAnswer) => void;
  onRetry?: () => void;
  /** When given, the done state shows "Next" (calls this) instead of "Done". */
  onNext?: () => void;
}

// ---------------------------------------------------------------- Confirm sheet

export type ConfirmPhase = 'idle' | 'submitting' | 'done' | 'error';

export interface ConfirmSheetProps extends OverlayBaseProps {
  student?: StudentId;
  /** The `confirm.pending` question text (owner only, already filtered by the hub). */
  question: string;
  /** Button labels in order; the first is the primary action. Default ['Yes', 'No']. */
  options?: string[];
  /** Plain lines under the question, e.g. "Shares: Tue 2 to 4 pm" / "Keeps private: your budget". */
  details?: { label: string; value: string; tone?: 'shared' | 'private' }[];
  phase?: ConfirmPhase;
  message?: string;
  /** Resolves the confirm. Receives the chosen option string and its index. */
  onChoose: (option: string, index: number) => void;
}
