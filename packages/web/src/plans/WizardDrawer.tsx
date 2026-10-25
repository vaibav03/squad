import { useState } from 'react';
import { Icon } from '../primitives/Icon';
import { Stepper } from '../primitives/Stepper';
import { timedFetch } from '../lib/http';
import { createBodyFromForm, MONTHS } from '../pages/trip/model';
import { FLOWS, type PlanKind } from './registry';
import './plans.css';

export interface WizardDrawerProps {
  kind: PlanKind;
  /** The group this plan belongs to (title shown so the scope is clear). */
  groupTitle: string;
  hub: { hubUrl: string; token: string | null } | null;
  onClose: () => void;
  /** A plan was created: `{kind, id}`. */
  onCreated?: (r: { kind: PlanKind; id: string }) => void;
}

/** Inline, data-driven wizard docked above the composer. The step list comes from the flow registry. */
export function WizardDrawer({ kind, groupTitle, hub, onClose, onCreated }: WizardDrawerProps) {
  const flow = FLOWS[kind];
  const [stepId, setStepId] = useState(flow.steps[0]!.id);
  const [created, setCreated] = useState<string | null>(null);
  const idx = flow.steps.findIndex((s) => s.id === stepId);
  const step = flow.steps[idx]!;
  const completed = flow.steps.slice(0, created ? 1 : 0).map((s) => s.id);
  const current = created ? 'availability' : stepId;
  return (
    <section
      className="sqp-drawer sqp-wizard"
      aria-label={flow.title}
      data-testid={`wizard-${kind}`}
    >
      <header className="sqp-drawer__head">
        <h3 className="sqp-drawer__title">
          <Icon name={kind === 'trip' ? 'plane' : 'book'} size={16} /> {flow.title}
        </h3>
        <span className="sqp-scope">for {groupTitle}</span>
        <button
          type="button"
          className="sqc-iconbtn"
          aria-label={`Close ${flow.title}`}
          onClick={onClose}
          data-testid="wizard-close"
        >
          <Icon name="x" size={18} />
        </button>
      </header>
      <Stepper
        steps={flow.steps.map((s) => ({ id: s.id, label: s.label }))}
        current={current}
        completed={completed}
        onStepClick={created ? undefined : setStepId}
      />
      <p className="sqp-note" data-testid="wizard-next">
        {created
          ? 'Brief saved. Next: agents check availability, then options and the private vote.'
          : step.hint}
      </p>
      {created ? (
        <Created kind={kind} id={created} />
      ) : kind === 'trip' && step.id === 'brief' ? (
        <TripBrief
          hub={hub}
          onDone={(id) => {
            setCreated(id);
            onCreated?.({ kind, id });
          }}
        />
      ) : (
        <p className="sqp-coming" data-testid="wizard-coming">
          Coming next: {step.label.toLowerCase()} is not built yet. Nothing is saved from this step.
        </p>
      )}
      {!created && idx > 0 ? (
        <div className="sqp-nav">
          <button
            type="button"
            className="sqp-btn"
            onClick={() => setStepId(flow.steps[idx - 1]!.id)}
          >
            Back
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Created({ kind, id }: { kind: PlanKind; id: string }) {
  return (
    <p className="sqp-note" role="status" data-testid="wizard-created">
      <Icon name="check" size={14} /> Plan started.{' '}
      <a
        className="sqc-link"
        href={
          kind === 'trip'
            ? `/squad/trips/${encodeURIComponent(id)}?full=1`
            : '/squad/village?plan=1'
        }
      >
        Open full plan
      </a>
    </p>
  );
}

function TripBrief({
  hub,
  onDone,
}: {
  hub: WizardDrawerProps['hub'];
  onDone: (id: string) => void;
}) {
  const [f, setF] = useState({ destination: '', month: '', days: '', perPerson: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    const body = createBodyFromForm(f);
    if (!body) return setErr('Add a destination of at least 2 characters.');
    if (!hub) return setErr('Connect to a hub to plan a trip.');
    setBusy(true);
    setErr(null);
    try {
      const r = await timedFetch(`${hub.hubUrl}/v1/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(hub.token ? { Authorization: `Bearer ${hub.token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => null)) as {
        trip?: { tripId?: string };
        error?: { message?: string };
      } | null;
      if (!r.ok || !j?.trip?.tripId) setErr(j?.error?.message ?? 'The trip could not be started.');
      else onDone(j.trip.tripId);
    } catch {
      setErr('The hub did not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="sqp-form"
      data-testid="trip-brief-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Destination
        <input
          value={f.destination}
          onChange={(e) => set('destination')(e.target.value)}
          data-testid="brief-destination"
          placeholder="Cabo"
        />
      </label>
      <label>
        Month
        <select
          value={f.month}
          onChange={(e) => set('month')(e.target.value)}
          data-testid="brief-month"
        >
          <option value="">Any time in the next 30 days</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Days
        <input
          inputMode="numeric"
          value={f.days}
          onChange={(e) => set('days')(e.target.value)}
          data-testid="brief-days"
          placeholder="4"
        />
      </label>
      <label>
        Budget per person ($)
        <input
          inputMode="numeric"
          value={f.perPerson}
          onChange={(e) => set('perPerson')(e.target.value)}
          data-testid="brief-budget"
          placeholder="1200"
        />
      </label>
      <p className="sqp-note">
        <Icon name="lock" size={12} /> Private per-member limits stay with each member&rsquo;s
        agent.
      </p>
      {err ? (
        <p role="alert" className="sqp-err">
          {err}
        </p>
      ) : null}
      <button
        type="submit"
        className="sqp-btn sqp-btn--primary"
        disabled={busy}
        data-testid="brief-submit"
      >
        {busy ? 'Starting...' : 'Start planning'}
      </button>
    </form>
  );
}
