import { useEffect, useId, useRef, useState } from 'react';
import {
  providerState,
  type BoardRun,
  type CouncilBoardStore,
} from '@squad/village/council';
import type { CouncilRunRecord } from '@squad/core';
import { CastAvatar } from '../../components/cast-avatar';
import { castName } from '../../components/cast-avatar/busts';
import { LvIcon } from '../../overlays/kit/icons';
import { DecisionsView } from '../../overlays/inspector/focus/DecisionsView';
import { FocusShell, type FocusTab } from '../../overlays/inspector/focus/FocusShell';
import { HandoffTimeline } from '../../overlays/inspector/focus/HandoffTimeline';
import { NoRunNote } from '../../overlays/inspector/focus/NoRunNote';
import '../../overlays/inspector/inspector.css';
import '../../overlays/inspector/focus/focus.css';
import { InitialTile } from './AgentCard';
import { ModeBadge } from './ModeBadge';
import { ROLE_LABEL, STATUS_LABEL } from './common';

const ICON = { queued: 'clock', working: 'refresh', done: 'check', failed: 'alert', skipped: 'x', partial: 'alert' } as const;

export interface BoardFocusPanelProps {
  store: CouncilBoardStore;
  run: BoardRun;
  agentId: string;
  record?: CouncilRunRecord | undefined;
  replay?: boolean | undefined;
  calm?: boolean | undefined;
  onClose(): void;
  onSelectAgent(id: string): void;
}

/**
 * The focused agent panel inside the Council board: the same Conversation | Activity | Decisions panel as the village
 * inspector, docked on the right of the board. One panel; picking another agent swaps its content in place.
 */
export function BoardFocusPanel({ store, run, agentId, record, replay, calm, onClose, onSelectAgent }: BoardFocusPanelProps) {
  const agent = run.agents.find((a) => a.id === agentId);
  const [tab, setTab] = useState<FocusTab>('conversation');
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setTab('conversation'), [agentId]);
  // Esc closes this panel only (not the board behind it); the board hands focus back to the control that opened it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, [agentId]);
  if (!agent) return null;
  const is = (id: string) => id === agent.id;
  const h = store.hierarchy(agent.id);
  const cast = agent.cast ? castName(agent.cast) : undefined;
  const provider = providerState(
    { mode: run.mode, agents: run.agents },
    { transport: record?.transport, fixture: !!replay },
  );
  const activity = (
    <div className="ai-tabpanel">
      <section aria-label="Right now">
        <h3 className="ai-label">Right now</h3>
        <p className="ai-headline">{agent.summary ?? STATUS_LABEL[agent.status]}</p>
        <dl className="ai-facts">
          <dt>Position</dt>
          <dd>{h?.position ?? ROLE_LABEL[agent.role]}</dd>
          {agent.stance ? (
            <>
              <dt>Stance</dt>
              <dd>{agent.stance}</dd>
            </>
          ) : null}
          <dt>Mode</dt>
          <dd>
            <ModeBadge mode={agent.mode} />
          </dd>
          {h?.parent ? (
            <>
              <dt>Reports to</dt>
              <dd>{h.parent.name}</dd>
            </>
          ) : null}
          {h && h.children.length > 0 ? (
            <>
              <dt>Delegates to</dt>
              <dd>{h.children.map((c) => c.name).join(', ')}</dd>
            </>
          ) : null}
        </dl>
      </section>
      {h && h.delegationsIn.length + h.delegationsOut.length > 0 ? (
        <section aria-label="Delegations">
          <h3 className="ai-label">Delegations</h3>
          <ul className="af-plain">
            {[...h.delegationsIn, ...h.delegationsOut].map((d) => (
              <li key={d.id}>
                {d.fromName} asked {d.toName}: {d.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="cb-focus"
      data-testid="agent-focus-panel"
      data-reduced={calm ? 'true' : undefined}
    >
      <FocusShell
        titleId={titleId}
        name={agent.name}
        role={ROLE_LABEL[agent.role]}
        portrait={
          cast ? (
            <CastAvatar name={cast} state="idle" size={1} {...(calm ? { calm: true } : {})} />
          ) : (
            <InitialTile name={agent.name} role={agent.role} />
          )
        }
        provider={provider}
        status={
          <>
            <LvIcon name={ICON[agent.status]} size={16} aria-hidden="true" />
            <span className="af-k">Status</span> {STATUS_LABEL[agent.status]}
          </>
        }
        tab={tab}
        onTab={setTab}
        swapKey={agent.id}
        onClose={onClose}
        panels={{
          conversation: (
            <div className="ai-tabpanel">
              <HandoffTimeline
                run={run}
                agent={{ id: agent.id, name: agent.name, is }}
                defaultFilter="selected"
                timeStyle="clock"
                onSelectAgent={onSelectAgent}
                emptyExtra={<NoRunNote />}
              />
            </div>
          ),
          activity,
          decisions: (
            <DecisionsView
              run={run}
              agentId={agent.id}
              is={is}
              name={agent.name}
              isChair={agent.role === 'chair'}
            />
          ),
        }}
      />
    </div>
  );
}
