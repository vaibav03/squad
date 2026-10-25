/**
 * Seam for the selected-agent panel (Conversation / Activity / Decisions), owned by `feature/agent-focus-panel`.
 * Anything on the deliberation surface that shows a portrait calls `openAgentPanel(agentId)`. The panel registers itself
 * with `registerAgentPanel(open)`; until it exists the board registers a fallback that narrows its own feed to that agent
 * (`{ fallback: true }`), and a window event `squad:agent-panel-open` is fired either way for decoupled listeners.
 * There is exactly one panel: this file never renders UI.
 */
export interface AgentPanelContext {
  runId?: string;
}
export type AgentPanelOpener = (agentId: string, ctx?: AgentPanelContext) => void;
export const AGENT_PANEL_EVENT = 'squad:agent-panel-open';

let primary: AgentPanelOpener | null = null;
let fallback: AgentPanelOpener | null = null;

export function registerAgentPanel(
  open: AgentPanelOpener,
  opts: { fallback?: boolean } = {},
): () => void {
  if (opts.fallback) {
    fallback = open;
    return () => {
      if (fallback === open) fallback = null;
    };
  }
  primary = open;
  return () => {
    if (primary === open) primary = null;
  };
}

export function openAgentPanel(agentId: string, ctx?: AgentPanelContext): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(AGENT_PANEL_EVENT, { detail: { agentId, ...ctx } }));
  (primary ?? fallback)?.(agentId, ctx);
}
