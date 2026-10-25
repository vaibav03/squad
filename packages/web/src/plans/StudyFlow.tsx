import { useEffect, useState } from 'react';
import type { PlanView } from '@squad/core';
import { modeTone, planModeLine } from './format';
import { Icon } from '../primitives/Icon';
import { Stepper } from '../primitives/Stepper';
import { dayLabel, minutesWords, planApi, STATUS_WORD, type PlanHub } from '../overlays/plan/model';
import { STUDY_FLOW } from './registry';
import type { PlanSeed } from './context';
import './plans.css';

const today = () => new Date().toISOString().slice(0, 10);

/** Where to start from: a plan already in the squad jumps to the edits/votes step. */
export function studyStepFor(plan: PlanView | null): string {
  if (!plan) return 'goal';
  return plan.status === 'active' ? 'plan' : 'edits';
}

/**
 * Study plan wizard on the hub plan service (docs/study-plan.md): goal -> availability -> draft -> edits/votes -> shared
 * plan card. The hub builds the draft from course materials, the squad's shared Canvas/Google items and busy/free days
 * only; it posts the one plan card into the group chat itself. Labels come from the plan's own generator mode.
 */
export function StudyFlow({ hub, seed }: { hub: PlanHub | null; seed?: PlanSeed | null }) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [step, setStep] = useState('goal');
  const [examDate, setExamDate] = useState(seed?.examDate ?? '');
  const [label, setLabel] = useState(seed?.label ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    if (!hub?.token) return;
    void planApi.current(hub).then((r) => {
      if (!dead && r.ok && r.plan && r.plan.status !== 'cancelled') {
        setPlan(r.plan);
        setStep(studyStepFor(r.plan));
      }
    });
    return () => {
      dead = true;
    };
  }, [hub?.hubUrl, hub?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name: string, f: () => ReturnType<typeof planApi.get>, next?: string) => {
    if (!hub) return setErr('Connect to a hub to plan.');
    setBusy(name);
    setErr(null);
    const r = await f();
    setBusy(null);
    if (r.ok) {
      if (r.plan) setPlan(r.plan);
      if (next) setStep(next);
    } else setErr(r.message ?? `That did not work (${r.code}).`);
  };

  const done = STUDY_FLOW.steps
    .map((s) => s.id)
    .filter(
      (id) =>
        STUDY_FLOW.steps.findIndex((s) => s.id === id) <
        STUDY_FLOW.steps.findIndex((s) => s.id === step),
    );
  const idx = STUDY_FLOW.steps.findIndex((s) => s.id === step);

  return (
    <div data-testid="study-flow" data-step={step}>
      <p className="sqp-note" data-testid="study-truth">
        {plan ? (
          <span
            className={`sqp-truth sqp-truth--${modeTone(plan.generator.mode)}`}
            data-testid="study-mode"
            data-mode={plan.generator.mode}
          >
            {planModeLine(plan.generator)}
          </span>
        ) : (
          <>
            <span className="sqp-truth" data-testid="study-mode" data-mode="none">
              Not drafted yet
            </span>{' '}
            Live, Demo or Degraded is shown once the draft is built.
          </>
        )}
      </p>
      <Stepper
        steps={STUDY_FLOW.steps.map((s) => ({ id: s.id, label: s.label }))}
        current={step}
        completed={done}
        onStepClick={(id) => {
          const target = STUDY_FLOW.steps.findIndex((s) => s.id === id);
          if (target <= idx || plan) setStep(id);
        }}
      />
      <p className="sqp-note" data-testid="wizard-next">
        {STUDY_FLOW.steps[idx]?.hint}
      </p>

      {seed && step !== 'plan' ? (
        <ul className="sqp-note" data-testid="study-context-chips" aria-label="Context from the answer">
          {seed.chips.map((c) => (
            <li key={c.id} data-testid="study-context-chip" data-kind={c.kind}>
              {c.label}
            </li>
          ))}
        </ul>
      ) : null}

      {step === 'goal' ? (
        <form
          className="sqp-form"
          data-testid="study-goal-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate))
              return setErr('Pick the exam or deadline date.');
            setErr(null);
            setStep('availability');
          }}
        >
          <label>
            Exam or deadline date
            <input
              type="date"
              min={today()}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              data-testid="study-date"
            />
          </label>
          <label>
            What is it for? (optional)
            <input
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Stats midterm"
              data-testid="study-label"
            />
          </label>
          <p className="sqp-note">
            Scope: your squad&rsquo;s course materials and the Canvas or Google items members chose
            to share. Nothing private is used.
          </p>
          <button type="submit" className="sqp-btn sqp-btn--primary" data-testid="study-next">
            Next
          </button>
        </form>
      ) : null}

      {step === 'availability' ? (
        <div className="sqp-stack" data-testid="study-availability">
          <p className="sqp-note">
            <Icon name="calendar" size={14} /> The hub reads only start and end times of connected
            calendar blocks to keep study days free. Event titles and each member&rsquo;s busy days
            are never shown. With no calendars connected, the draft uses the course materials alone
            and says so.
          </p>
          <div className="sqp-nav">
            <button type="button" className="sqp-btn" onClick={() => setStep('goal')}>
              Back
            </button>
            <button
              type="button"
              className="sqp-btn sqp-btn--primary"
              data-testid="study-draft"
              disabled={busy === 'draft'}
              onClick={() =>
                void run(
                  'draft',
                  () => planApi.propose(hub!, examDate, {
                    ...(label ? { examLabel: label } : {}),
                    ...(seed?.sourceIds.length ? { contextSourceIds: seed.sourceIds } : {}),
                  }),
                  'draft',
                )
              }
            >
              {busy === 'draft' ? 'Building the draft...' : 'Draft sessions'}
            </button>
          </div>
        </div>
      ) : null}

      {plan && step === 'draft' ? (
        <div className="sqp-stack" data-testid="study-draft-view">
          <PlanSummary plan={plan} />
          <div className="sqp-nav">
            <button
              type="button"
              className="sqp-btn sqp-btn--primary"
              onClick={() => setStep('edits')}
              data-testid="study-to-edits"
            >
              Review and vote
            </button>
          </div>
        </div>
      ) : null}

      {plan && step === 'edits' ? (
        <div className="sqp-stack" data-testid="study-edits">
          <PlanSummary plan={plan} />
          <ul className="sqp-list">
            {plan.items.map((it) => (
              <li key={it.id} className="sqp-row" data-testid={`study-item-${it.id}`}>
                <span className="sqp-row__text">
                  <span className="sqp-row__title">{it.title}</span>
                  <span className="sqp-row__sub">
                    {it.ownerName} · {dayLabel(it.date)} · {minutesWords(it.durationMin)}
                  </span>
                </span>
                <input
                  type="date"
                  aria-label={`Move ${it.title}`}
                  value={it.date}
                  disabled={plan.status !== 'proposed'}
                  onChange={(e) =>
                    e.target.value
                      ? void run('edit', () =>
                          planApi.edit(hub!, plan.id, it.id, plan.rev, { date: e.target.value }),
                        )
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
          {plan.conflicts.some((c) => c.status === 'open') ? (
            <p role="alert" className="sqp-err" data-testid="study-conflict">
              Someone changed the same item at the same time. Nothing was overwritten; pick a
              version in the plan panel.
            </p>
          ) : null}
          <div className="sqp-nav">
            {plan.status === 'proposed' && plan.me.response === 'pending' ? (
              <>
                <button
                  type="button"
                  className="sqp-btn sqp-btn--primary"
                  data-testid="study-accept"
                  onClick={() => void run('accept', () => planApi.respond(hub!, plan.id, 'accept'))}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="sqp-btn"
                  onClick={() =>
                    void run('decline', () => planApi.respond(hub!, plan.id, 'decline'))
                  }
                >
                  Decline
                </button>
              </>
            ) : null}
            {plan.status === 'proposed' && plan.me.isOrganizer ? (
              <button
                type="button"
                className="sqp-btn"
                data-testid="study-confirm"
                onClick={() => void run('confirm', () => planApi.confirm(hub!, plan.id), 'plan')}
              >
                Confirm and start
              </button>
            ) : null}
            <button type="button" className="sqp-btn" onClick={() => setStep('plan')}>
              Shared plan
            </button>
          </div>
        </div>
      ) : null}

      {plan && step === 'plan' ? (
        <div className="sqp-stack" data-testid="study-shared">
          <PlanSummary plan={plan} />
          <p className="sqp-note" role="status">
            <Icon name="check" size={14} /> The shared plan card is in the group chat. Everyone can
            edit, accept or ask Cubbie from it.
          </p>
        </div>
      ) : null}

      {err ? (
        <p role="alert" className="sqp-err" data-testid="study-error">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function PlanSummary({ plan }: { plan: PlanView }) {
  const squad = plan.availability.squad;
  return (
    <div className="sqp-stack" data-testid="study-summary" data-plan-id={plan.id}>
      <p className="sqp-note">
        <strong>{plan.title}</strong> · {STATUS_WORD[plan.status] ?? plan.status}
        {plan.countdown ? ` · ${plan.countdown.words}` : ''} · {plan.progress.words}
      </p>
      <p className="sqp-note" data-testid="study-sources">
        {plan.citations.length} {plan.citations.length === 1 ? 'source' : 'sources'}
        {plan.citations.length
          ? `: ${plan.citations
              .slice(0, 4)
              .map((c) => c.label)
              .join('; ')}`
          : ''}
      </p>
      <p className="sqp-note" data-testid="study-aggregate">
        {squad
          ? `Free-day overlap is shown as counts only (${squad.length} days).`
          : 'Group availability stays hidden below 3 members.'}
      </p>
    </div>
  );
}
