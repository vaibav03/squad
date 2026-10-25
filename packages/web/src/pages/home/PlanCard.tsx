import { useEffect, useState } from 'react';
import { agoWords, planBadge, type PlanView } from '@squad/core';
import { Card } from '../../primitives/Card';
import { useSquadConfig } from '../../shell/context';
import { planApi } from '../../overlays/plan/model';
import '../../overlays/plan/plan.css';

/** Home entry point for the shared study plan: state, mode badge, countdown and a link to the village panel. */
export function HomePlanCard() {
  const cfg = useSquadConfig();
  const hub = cfg.hubUrl && cfg.token ? { hubUrl: cfg.hubUrl, token: cfg.token } : null;
  const [plan, setPlan] = useState<PlanView | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    if (!hub) return;
    void planApi.current(hub).then((r) => {
      if (!dead) setPlan(r.ok ? r.plan : null);
    });
    return () => {
      dead = true;
    };
  }, [hub?.hubUrl, hub?.token]);
  const badge = plan ? planBadge(plan.generator) : null;
  return (
    <Card padding="md">
      <div data-testid="home-plan-card">
        <h3>Study plan</h3>
        {plan === undefined && hub ? (
          <p className="rr-dim" role="status">
            Loading the plan...
          </p>
        ) : !plan ? (
          <p>
            No study plan yet. Propose one for your next exam; the whole squad gets it to accept.
          </p>
        ) : (
          <>
            {badge && (
              <p>
                <span
                  className={`pl-badge pl-badge--${badge.mode}`}
                  data-testid="plan-mode-badge"
                  data-mode={badge.mode}
                >
                  {badge.label}
                </span>{' '}
                <span className="rr-dim">{badge.kindLabel}</span>
              </p>
            )}
            <p data-testid="home-plan-countdown">
              {plan.countdown ? plan.countdown.words : 'No exam date set'} · {plan.progress.words}
            </p>
            <p className="rr-dim" data-testid="home-plan-saved">
              Saved, version {plan.saved?.rev ?? plan.rev}
              {plan.saved ? `, edited ${agoWords(plan.saved.lastEditedAt, Date.now())}` : ''}
            </p>
          </>
        )}
        <a
          className="lv-btn lv-btn--primary"
          href="/squad/village?plan=1"
          data-testid="home-plan-open"
        >
          {plan ? 'Open the plan' : 'Propose a plan'}
        </a>
      </div>
    </Card>
  );
}
