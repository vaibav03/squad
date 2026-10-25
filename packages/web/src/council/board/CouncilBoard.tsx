import type { CouncilBoardStore } from '@squad/village/council';
import type { HubCtx } from '../../pages/village/hub';

export interface CouncilBoardProps {
  store: CouncilBoardStore;
  open: boolean;
  onClose(): void;
  /** Agent to focus in the org chart on open. */
  focusAgent?: string;
  calm?: boolean;
  hub?: HubCtx | null;
  returnFocusTo?: HTMLElement | null;
}

/** PLACEHOLDER: the real board is built in this file's siblings (workstream W5). */
export function CouncilBoard({ open }: CouncilBoardProps) {
  return open ? <div role="dialog" aria-label="Council board" /> : null;
}
