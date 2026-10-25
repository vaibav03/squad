import { useEffect, useId, useRef, useState } from 'react';
import {
  a2aPartyName,
  providerState,
  type BoardRun,
  type CouncilBoardStore,
} from '@squad/village/council';
import type { CouncilRunRecord } from '@squad/core';
import { LvIcon } from '../../overlays/kit/icons';
import { DecisionsView } from '../../overlays/inspector/focus/DecisionsView';
import { FocusShell, type FocusTab } from '../../overlays/inspector/focus/FocusShell';
import { HandoffTimeline } from '../../overlays/inspector/focus/HandoffTimeline';
import { EmptyHelp } from '../../overlays/inspector/focus/EmptyHelp';
import '../../overlays/inspector/inspector.css';
import '../../overlays/inspector/focus/focus.css';
import { Portrait } from '../deliberation/Portrait';
import { resolveParticipant } from '../deliberation/participants';
import { ModeBadge } from './ModeBadge';
import { ROLE_LABEL, STATUS_LABEL } from './common';

const ICON = {
  queued: 'clock',
  working: 'refresh',
  done: 'check',
  failed: 'alert',
  skipped: 'x',
  partial: 'alert',
} as const;

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
export function BoardFocusPanel({
  store,
  run,
  agentId,
  record,
  replay,
  calm,
  onClose,
  onSelectAgent,
}: BoardFocusPanelProps) {
  const agent = run.agents.find((a) => a.id === agentId);
  const [tab, setTab] = useState<FocusTab>('conversation');
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
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
          <dt>Status</dt>
          <dd>{STATUS_LABEL[agent.status]}</dd>
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
        </dl>
      </section>
    </div>
  );
  // Team: who this agent works with, from the run's handoffs (names are buttons that swap the panel).
  const partners = new Map<string, number>();
  for (const m of run.messages) {
    const other = m.from === agent.id ? m.to : m.to === agent.id ? m.from : '';
    if (other && other !== 'room' && !other.startsWith('tool:'))
      partners.set(other, (partners.get(other) ?? 0) + 1);
  }
  const team = (
    <div className="ai-tabpanel">
      <h3 className="ai-label">Who {agent.name} works with</h3>
      {partners.size === 0 ? (
        <EmptyHelp
          isCouncil
          topic={agent.name}
          title={`${agent.name} has not worked with anyone yet`}
        />
      ) : (
        <ul className="ai-partners">
          {[...partners].map(([id, n]) => (
            <li key={id}>
              <button
                type="button"
                className="ai-party ai-party--btn"
                onClick={() => onSelectAgent(id)}
              >
                {a2aPartyName(id)}
              </button>
              <span className="ai-count">
                {n} {n === 1 ? 'message' : 'messages'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  // Structure: who reports to whom.
  const structure = (
    <div className="ai-tabpanel">
      <h3 className="ai-label">Who reports to whom</h3>
      <dl className="ai-facts">
        <dt>Position</dt>
        <dd>{h?.position ?? ROLE_LABEL[agent.role]}</dd>
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
      {h && h.delegationsIn.length + h.delegationsOut.length > 0 ? (
        <ul className="af-plain">
          {[...h.delegationsIn, ...h.delegationsOut].map((d) => (
            <li key={d.id}>
              {d.fromName} asked {d.toName}: {d.summary}
            </li>
          ))}
        </ul>
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
          <Portrait
            who={resolveParticipant(agent.id, agent.name)}
            {...(calm ? { calm: true } : {})}
          />
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
                emptyExtra={<EmptyHelp isCouncil topic={agent.name} />}
              />
            </div>
          ),
          activity,
          reasoning: (
            <DecisionsView
              run={run}
              agentId={agent.id}
              is={is}
              name={agent.name}
              isChair={agent.role === 'chair'}
            />
          ),
          team,
          structure,
        }}
      />
    </div>
  );
}
