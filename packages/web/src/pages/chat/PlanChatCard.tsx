import { useEffect, useState } from 'react';
import { planBadge, type PlanView } from '@squad/core';
import { PLAN_OPEN_EVENT } from '@squad/village/rooms';
import { planApi, type PlanHub } from '../../overlays/plan/model';
import '../../overlays/plan/plan.css';
import { openSource } from '../../components/source-viewer';

export interface PlanChatCardProps {
  hub: PlanHub | null;
  planId: string;
  status?: string | undefined;
  rev?: number | undefined;
}

/** Chat card for a shared study plan: who built it (agent or fallback), the mode badge and the sources it used. */
export function PlanChatCard({ hub, planId, status, rev }: PlanChatCardProps) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  useEffect(() => {
    let dead = false;
    if (!hub?.token) return;
    void planApi.get(hub, planId).then((r) => {
      if (!dead && r.ok && r.plan) setPlan(r.plan);
    });
    return () => {
      dead = true;
    };
  }, [hub?.hubUrl, hub?.token, planId, rev]);
  const badge = plan ? planBadge(plan.generator) : null;
  const sources = plan ? plan.citations : [];
  return (
    <div className="sqc-plancard" data-testid="chat-plan-card">
      <strong>Study plan</strong>
      <span className="rr-dim">
        {' '}
        {(plan?.status ?? status) ? `(${plan?.status ?? status})` : ''}
      </span>
      {badge ? (
        <p>
          <span
            className={`pl-badge pl-badge--${badge.mode}`}
            data-testid="plan-mode-badge"
            data-mode={badge.mode}
          >
            {badge.label}
          </span>{' '}
          <span className="rr-dim" data-testid="plan-kind">
            {badge.kindLabel}
          </span>
        </p>
      ) : null}
      {plan?.rationale ? <p data-testid="plan-rationale">{plan.rationale}</p> : null}
      {plan ? (
        <p className="rr-dim" data-testid="plan-sources">
          {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          {sources.length ? ': ' : ''}
          {sources.slice(0, 6).map((c, i) =>
            c.kind === 'material' && c.file && c.page ? (
              <button
                key={`${c.label}-${i}`}
                type="button"
                className="sqc-cite"
                onClick={() => openSource({ file: c.file!, page: c.page! })}
              >
                {c.label}
              </button>
            ) : (
              <span key={`${c.label}-${i}`}>{c.label}; </span>
            ),
          )}
        </p>
      ) : null}
      <a
        className="lv-btn"
        href="/squad/village?plan=1"
        onClick={(e) => {
          if (location.pathname.includes('/village')) {
            e.preventDefault();
            globalThis.dispatchEvent(new Event(PLAN_OPEN_EVENT));
          }
        }}
      >
        Open plan
      </a>
    </div>
  );
}
