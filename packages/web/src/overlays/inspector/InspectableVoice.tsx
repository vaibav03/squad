import { useSyncExternalStore, type ReactNode } from 'react';
import { getInspectorStore, openVoice, useCanInspect } from './bridge';
import './inspector.css';

const ROOM_AGENT: Record<string, string> = {
  'council-hall': 'council:quizkey',
  'round-table': 'council:planner',
  'debate-stage': 'council:debate',
};

function useVoiceThinking(who: string, agent: string): boolean {
  const store = getInspectorStore();
  return useSyncExternalStore(
    (cb) => (store ? store.subscribe(cb) : () => undefined),
    () => (store ? store.isThinking(agent, who) : false),
    () => false,
  );
}

/**
 * Makes a council agent (a name, an avatar, a card header) hoverable and pressable anywhere in the DOM. Hover or
 * keyboard focus shows only a compact name tag, with three quiet dots when the agent is thinking now. Press, click or
 * Enter opens the Agent Inspector docked card on that agent. Renders its children unchanged when no village
 * inspector is mounted on the page.
 */
export function InspectableVoice({
  who,
  name,
  agent,
  slot = '',
  className,
  children,
}: {
  who: string;
  name: string;
  agent?: string;
  slot?: string;
  className?: string;
  children: ReactNode;
}) {
  const can = useCanInspect();
  const a = agent ?? ROOM_AGENT[slot] ?? 'council:council';
  const thinking = useVoiceThinking(who, a);
  if (!can) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      className={['ai-voice', className].filter(Boolean).join(' ')}
      data-voice={who}
      data-thinking={thinking || undefined}
      aria-label={`${name}${thinking ? ', thinking now' : ''}. Open in the inspector`}
      onClick={() => openVoice(who, { agent: a, slot })}
    >
      {children}
      <span className="ai-voice__tag" aria-hidden="true">
        {name}
        {thinking && (
          <span className="ai-dots">
            <i />
            <i />
            <i />
          </span>
        )}
      </span>
    </button>
  );
}
