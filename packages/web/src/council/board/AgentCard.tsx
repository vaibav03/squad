import type { BoardAgent } from '@squad/village/council';
import { CastAvatar } from '../../components/cast-avatar';
import { castName, type CastState } from '../../components/cast-avatar/busts';
import { ModeBadge } from './ModeBadge';
import { ROLE_LABEL, StatusChip, classes } from './common';

/** Pixel-bordered initial tile for agents without cast art (same 32px footprint as a bust). */
export function InitialTile({ name, role }: { name: string; role: BoardAgent['role'] }) {
  return (
    <span className="cb-tile" data-role={role} aria-hidden="true">
      {role === 'code' ? '⚙' : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export interface AgentCardProps {
  agent: BoardAgent;
  calm?: boolean;
  selected?: boolean;
  highlighted?: boolean;
}

/** One node of the org chart: who, what role, how honest, what state, and the PUBLIC summary. Never raw thinking. */
export function AgentCard({ agent, calm, selected, highlighted }: AgentCardProps) {
  const cast = agent.cast ? castName(agent.cast) : undefined;
  const state: CastState =
    agent.status === 'working' ? 'talk' : agent.status === 'queued' ? 'think' : 'idle';
  const stance = agent.status === 'done' || agent.status === 'partial' ? agent.stance : undefined;
  return (
    <div
      className={classes('cb-card', selected && 'is-selected', highlighted && 'is-hl')}
      data-role={agent.role}
      data-status={agent.status}
    >
      <div className="cb-card__head">
        {cast ? (
          <span className="cb-card__avatar">
            <CastAvatar name={cast} state={state} size={1} {...(calm ? { calm: true } : {})} />
          </span>
        ) : (
          <InitialTile name={agent.name} role={agent.role} />
        )}
        <span className="cb-card__name">{agent.name}</span>
        <StatusChip status={agent.status} />
      </div>
      <div className="cb-card__meta">
        <span className="cb-chip" data-role={agent.role}>
          {ROLE_LABEL[agent.role]}
        </span>
        <ModeBadge mode={agent.mode} compact />
      </div>
      {agent.summary ? <p className="cb-card__summary">{agent.summary}</p> : null}
      {stance ? (
        <p className="cb-card__stance">
          <span className="cb-card__stance-k">Position</span> {stance}
        </p>
      ) : null}
    </div>
  );
}
