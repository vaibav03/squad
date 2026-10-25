import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Page, Skeleton } from '../../primitives';
import {
  Avatar,
  ConnectionBadge,
  LvIcon,
  StateBlock,
  propArt,
  type Connection,
} from '../../overlays/kit';
import {
  MODE_TITLE,
  MONTHS,
  agentLabel,
  createBodyFromForm,
  cutsceneHref,
  initialRanking,
  money,
  move,
  optionMeta,
  type TripMember,
  type TripOptionV2,
  type TripViewV2,
} from './model';
import type { OptionPatch, PendingConflict, TripAction, TripStatus } from './useTrip';
import './trip.css';

export type { TripStatus };

export interface TripActions {
  create: (body: NonNullable<ReturnType<typeof createBodyFromForm>>) => void;
  propose: (body: { label: string; days?: number; perPerson?: number }) => void;
  editOption: (optionId: string, patch: OptionPatch, baseRev: number) => void;
  removeOption: (optionId: string, baseRev: number) => void;
  vote: (ranking: string[], baseRev: number) => void;
  confirm: (optionId: string | undefined, yes: boolean, baseRev?: number) => void;
  act: (name: TripAction) => void;
  keepTheirs: () => void;
  replaceWithMine: () => void;
}
const noop = () => {};
export const noActions: TripActions = {
  create: noop,
  propose: noop,
  editOption: noop,
  removeOption: noop,
  vote: noop,
  confirm: noop,
  act: noop,
  keepTheirs: noop,
  replaceWithMine: noop,
};

export interface TripViewProps {
  status: TripStatus;
  connection: Connection;
  /** undefined while loading, null when the squad has no trip yet. */
  trip?: TripViewV2 | null;
  /** Signed-in student id (marks "You"). */
  me: string;
  actions?: TripActions;
  busy?: string | null;
  actionError?: string | null;
  conflict?: PendingConflict | null;
  /** Body for status 'error'; defaults to the network copy. */
  errorMessage?: string;
  /** The requested trip id does not exist (or belongs to another squad). */
  notFound?: boolean;
  onRetry?: () => void;
  /** Called when the user follows the cutscene link (so the page can mark it seen). */
  onWatchCutscene?: (view: TripViewV2) => void;
  /** Shown inside the group chat: no link may leave the chat (the cutscene link is left out). */
  inline?: boolean;
}

export function TripView(props: TripViewProps) {
  const { status, connection, trip, errorMessage, onRetry } = props;
  const actions = props.actions ?? noActions;
  return (
    <Page
      className="lv-trip"
      eyebrow="Plan together"
      title={trip?.title ?? 'Trip planner'}
      actions={<ConnectionBadge connection={connection} />}
    >
      <p className="lv-lede">
        Everyone&rsquo;s calendars and budgets stay private. Your agent checks them and only shares
        what has to be shared.
      </p>
      {status === 'loading' && <TripSkeleton />}
      {status === 'error' && (
        <div data-testid="trip-error">
          <StateBlock
            kind="error"
            title="The trip did not load"
            body={errorMessage ?? 'The hub did not answer. Your answers are safe; try again.'}
            onRetry={onRetry}
            retryLabel="Retry"
          />
        </div>
      )}
      {status === 'offline' && (
        <div data-testid="trip-offline">
          <StateBlock
            kind="offline"
            title="You are offline"
            body="Nothing is lost. Votes and confirmations wait until your connection is back."
            onRetry={onRetry}
            retryLabel="Retry"
          />
        </div>
      )}
      {status === 'ready' && !trip && (
        <EmptyTrip
          notFound={props.notFound}
          busy={props.busy === 'create'}
          error={props.actionError}
          onCreate={actions.create}
        />
      )}
      {status === 'ready' && trip && <TripBody {...props} trip={trip} actions={actions} />}
    </Page>
  );
}

/* ---------- empty ---------- */

function EmptyTrip({
  notFound,
  busy,
  error,
  onCreate,
}: {
  notFound?: boolean;
  busy: boolean;
  error?: string | null;
  onCreate: TripActions['create'];
}) {
  return (
    <section className="lv-card lv-trip__empty" data-testid="trip-empty" aria-labelledby="empty-h">
      <h2 id="empty-h" className="lv-sec__title">
        {notFound ? 'We could not find that trip' : 'No trip planned yet'}
      </h2>
      <p className="lv-card__line">
        Plan one with your squad. Everyone&rsquo;s agent checks free days and budgets without
        sharing calendars.
      </p>
      <CreateForm busy={busy} onCreate={onCreate} openLabel="Plan a trip" />
      {error && (
        <p role="alert" className="lv-trip__err" data-testid="trip-action-error">
          {error}
        </p>
      )}
      <p className="lv-card__foot">Or ask in chat: @cubbie plan a trip to Cabo in March</p>
    </section>
  );
}

/** The create form behind 'Plan a trip' (empty state) and 'Plan another trip' (after a trip ended). */
function CreateForm({
  busy,
  onCreate,
  openLabel,
}: {
  busy: boolean;
  onCreate: TripActions['create'];
  openLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ destination: '', month: '', days: '', perPerson: '' });
  const body = createBodyFromForm(f);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body) onCreate(body);
  };
  return (
    <>
      {!open && (
        <Button
          variant="primary"
          data-testid="trip-create-open"
          iconStart="plane"
          onClick={() => setOpen(true)}
        >
          {openLabel}
        </Button>
      )}
      {open && (
        <form
          className="lv-form"
          data-testid="trip-create-form"
          aria-label={openLabel}
          onSubmit={submit}
        >
          <label className="lv-field">
            <span>Destination</span>
            <input
              required
              minLength={2}
              maxLength={60}
              value={f.destination}
              onChange={(e) => setF({ ...f, destination: e.target.value })}
              placeholder="Cabo"
            />
          </label>
          <label className="lv-field">
            <span>Month (optional)</span>
            <select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>
              <option value="">Any time soon</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="lv-field">
            <span>Days (optional)</span>
            <input
              type="number"
              min={1}
              max={14}
              value={f.days}
              onChange={(e) => setF({ ...f, days: e.target.value })}
            />
          </label>
          <label className="lv-field">
            <span>Cost per person, USD (optional)</span>
            <input
              type="number"
              min={0}
              max={100000}
              value={f.perPerson}
              onChange={(e) => setF({ ...f, perPerson: e.target.value })}
            />
          </label>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !body}>
            Start planning
          </Button>
        </form>
      )}
    </>
  );
}

/* ---------- body ---------- */

const STATUS_LABEL: Record<TripViewV2['status'], string> = {
  planning: 'Planning',
  voting: 'Voting',
  confirming: 'Confirming',
  confirmed: 'Confirmed',
  failed: 'Did not work out',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

function TripBody({
  trip,
  me,
  actions,
  busy = null,
  actionError,
  conflict,
  onWatchCutscene,
  inline,
}: TripViewProps & { trip: TripViewV2; actions: TripActions }) {
  const ended =
    trip.status === 'failed' || trip.status === 'expired' || trip.status === 'cancelled';
  const chosenOpt = trip.chosen
    ? trip.options.find((o) => o.id === trip.chosen!.optionId)
    : undefined;
  return (
    <div data-testid={`trip-state-${trip.status}`} data-status={trip.status}>
      <p className="lv-trip__status" data-testid="trip-status">
        <span className="lv-tag lv-tag--lead">{STATUS_LABEL[trip.status]}</span>
        {trip.window && (
          <span className="lv-sec__hint">
            Window {trip.window.from} to {trip.window.to}
          </span>
        )}
      </p>

      {conflict && <ConflictBanner conflict={conflict} busy={busy} actions={actions} />}
      {actionError && (
        <p role="alert" className="lv-trip__err" data-testid="trip-action-error">
          {actionError}
        </p>
      )}

      {trip.status === 'confirmed' && (
        <section
          className="lv-trip__done"
          role="status"
          aria-live="polite"
          data-testid="trip-celebration"
          aria-label="Trip confirmed"
        >
          <img
            className="sq-sprite"
            src={propArt.van.url}
            width={propArt.van.w}
            height={propArt.van.h}
            alt=""
          />
          <div>
            <h2>Trip confirmed{chosenOpt ? `: ${chosenOpt.label}` : ''}</h2>
            <p>
              Everyone said yes{trip.chosen?.dates ? `. ${trip.chosen.dates}` : ''}. The van is
              packed.
            </p>
          </div>
          {!inline && (
            <div className="lv-trip__donebtns">
              <Button
                as="a"
                variant="primary"
                iconEnd="arrow-right"
                href={cutsceneHref(trip.taskId)}
                data-testid="trip-cutscene-link"
                onClick={() => onWatchCutscene?.(trip)}
              >
                Watch the trip cutscene
              </Button>
            </div>
          )}
        </section>
      )}

      {ended && (
        <section
          className="lv-card lv-trip__ended"
          data-testid="trip-ended"
          aria-label={STATUS_LABEL[trip.status]}
        >
          <h2 className="lv-card__title">
            <LvIcon name="alert" size={16} /> {STATUS_LABEL[trip.status]}
          </h2>
          <p className="lv-card__line" data-testid="trip-failure">
            {trip.failure?.message ?? 'This trip is no longer active.'}
          </p>
          {trip.can.reopen && (
            <Button
              variant="primary"
              data-testid="trip-reopen"
              loading={busy === 'reopen'}
              onClick={() => actions.act('reopen')}
            >
              Reopen
            </Button>
          )}
        </section>
      )}

      <div className="lv-trip__grid">
        <div className="lv-trip__main">
          {trip.status === 'confirming' && (
            <ConfirmCard trip={trip} chosenOpt={chosenOpt} busy={busy} actions={actions} />
          )}
          {trip.status === 'voting' && <VoteCard trip={trip} busy={busy} actions={actions} />}
          <OptionsCard trip={trip} busy={busy} actions={actions} />
          {(trip.status === 'planning' || trip.status === 'voting') && trip.can.propose && (
            <ProposeForm busy={busy === 'propose'} onPropose={actions.propose} />
          )}
          {trip.recommendation && <Recommendation trip={trip} />}
          {(trip.status === 'planning' || trip.status === 'voting') && trip.can.closeVoting && (
            <div className="lv-trip__cta">
              <Button
                variant="secondary"
                data-testid="trip-close-voting"
                loading={busy === 'close-voting'}
                onClick={() => actions.act('close-voting')}
              >
                Close voting
              </Button>
            </div>
          )}
          {trip.can.cancel && (
            <div className="lv-trip__cta">
              <Button
                variant="ghost"
                data-testid="trip-cancel"
                loading={busy === 'cancel'}
                onClick={() => actions.act('cancel')}
              >
                Cancel the trip
              </Button>
            </div>
          )}
        </div>
        <aside className="lv-trip__side">
          <Constraints trip={trip} busy={busy} actions={actions} />
          <Members trip={trip} me={me} />
          {trip.myLimits && <Limits limits={trip.myLimits} />}
          <Activity trip={trip} />
        </aside>
      </div>
      {(ended || trip.status === 'confirmed' || trip.source === 'seed') && (
        <section className="lv-card lv-trip__another" data-testid="trip-another">
          <h2 className="lv-card__title">Another trip?</h2>
          <CreateForm
            busy={busy === 'create'}
            onCreate={actions.create}
            openLabel="Plan another trip"
          />
        </section>
      )}
    </div>
  );
}

/* ---------- conflict ---------- */

function ConflictBanner({
  conflict,
  busy,
  actions,
}: {
  conflict: PendingConflict;
  busy: string | null;
  actions: TripActions;
}) {
  const ch = conflict.conflict.change;
  return (
    <section role="alert" className="lv-trip__conflict" data-testid="trip-conflict">
      <h2 className="lv-card__title">
        <LvIcon name="alert" size={16} /> Someone changed this first
      </h2>
      <p className="lv-card__line" data-testid="trip-conflict-detail">
        {ch ? `${ch.byName}: ${ch.summary}` : conflict.message}
      </p>
      <div className="lv-trip__donebtns">
        <Button variant="secondary" data-testid="trip-keep-theirs" onClick={actions.keepTheirs}>
          Keep theirs
        </Button>
        <Button
          variant="primary"
          data-testid="trip-replace-mine"
          loading={busy !== null}
          onClick={actions.replaceWithMine}
        >
          Replace with mine
        </Button>
      </div>
    </section>
  );
}

/* ---------- options ---------- */

function OptionsCard({
  trip,
  busy,
  actions,
}: {
  trip: TripViewV2;
  busy: string | null;
  actions: TripActions;
}) {
  const [editing, setEditing] = useState<{ id: string; baseRev: number } | null>(null);
  const editable = trip.can.propose && trip.status === 'planning';
  return (
    <section className="lv-card" aria-labelledby="opts-h" data-testid="trip-options">
      <h2 id="opts-h" className="lv-sec__title">
        Options
      </h2>
      {trip.options.length === 0 ? (
        <p className="lv-card__empty">No options yet. Propose the first one.</p>
      ) : (
        <ol className="lv-opts">
          {trip.options.map((o) => (
            <li
              key={o.id}
              className="lv-opt lv-opt--plain"
              data-vetoed={!!o.droppedReason || undefined}
              data-leading={
                trip.chosen?.optionId === o.id ||
                trip.recommendation?.optionId === o.id ||
                undefined
              }
              data-testid={`trip-option-${o.id}`}
            >
              <div className="lv-opt__main">
                <h3 className="lv-opt__name">
                  {o.label}
                  {trip.recommendation?.optionId === o.id && (
                    <span className="lv-tag lv-tag--lead">Council pick</span>
                  )}
                </h3>
                <p className="lv-opt__meta">
                  {optionMeta(o) || 'no quote yet'}
                  {o.proposedByName ? ` · proposed by ${o.proposedByName}` : ''}
                </p>
                {o.droppedReason && (
                  <p className="lv-opt__fit" data-fit="veto">
                    <LvIcon name="x" size={14} /> Dropped: {o.droppedReason}
                  </p>
                )}
                {editing?.id === o.id && (
                  <EditOption
                    option={o}
                    busy={busy === 'edit'}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => {
                      actions.editOption(o.id, patch, editing.baseRev);
                      setEditing(null);
                    }}
                  />
                )}
              </div>
              {editable && !o.droppedReason && editing?.id !== o.id && (
                <div className="lv-opt__move">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Edit ${o.label}`}
                    onClick={() => setEditing({ id: o.id, baseRev: trip.rev })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${o.label}`}
                    loading={busy === 'remove'}
                    onClick={() => actions.removeOption(o.id, trip.rev)}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EditOption({
  option,
  busy,
  onSave,
  onCancel,
}: {
  option: TripOptionV2;
  busy: boolean;
  onSave: (p: OptionPatch) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(option.label);
  const [days, setDays] = useState(option.days ? String(option.days) : '');
  const [pp, setPp] = useState(option.perPerson !== undefined ? String(option.perPerson) : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: OptionPatch = {};
    if (label.trim() !== option.label) patch.label = label.trim();
    if (days && Number(days) !== option.days) patch.days = Number(days);
    if (pp !== '' && Number(pp) !== option.perPerson) patch.perPerson = Number(pp);
    onSave(patch);
  };
  return (
    <form
      className="lv-form lv-form--inline"
      aria-label={`Edit ${option.label}`}
      data-testid="trip-edit-form"
      onSubmit={submit}
    >
      <label className="lv-field">
        <span>Name</span>
        <input
          value={label}
          minLength={2}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="lv-field">
        <span>Days</span>
        <input
          type="number"
          min={1}
          max={14}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </label>
      <label className="lv-field">
        <span>Per person</span>
        <input type="number" min={0} value={pp} onChange={(e) => setPp(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" size="sm" loading={busy}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function ProposeForm({ busy, onPropose }: { busy: boolean; onPropose: TripActions['propose'] }) {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('');
  const [pp, setPp] = useState('');
  const ok = label.trim().length >= 2;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    onPropose({
      label: label.trim(),
      ...(days ? { days: Number(days) } : {}),
      ...(pp !== '' ? { perPerson: Number(pp) } : {}),
    });
    setLabel('');
    setDays('');
    setPp('');
  };
  return (
    <form
      className="lv-card lv-form"
      aria-label="Propose an option"
      data-testid="trip-propose-form"
      onSubmit={submit}
    >
      <h2 className="lv-card__title">
        <LvIcon name="plane" size={16} /> Propose an option
      </h2>
      <label className="lv-field">
        <span>Where</span>
        <input
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Austin weekend"
        />
      </label>
      <label className="lv-field">
        <span>Days (optional)</span>
        <input
          type="number"
          min={1}
          max={14}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </label>
      <label className="lv-field">
        <span>Cost per person (optional)</span>
        <input type="number" min={0} value={pp} onChange={(e) => setPp(e.target.value)} />
      </label>
      <Button type="submit" variant="primary" loading={busy} disabled={!ok || busy}>
        Add option
      </Button>
    </form>
  );
}

/* ---------- voting ---------- */

function VoteCard({
  trip,
  busy,
  actions,
}: {
  trip: TripViewV2;
  busy: string | null;
  actions: TripActions;
}) {
  const [ranking, setRanking] = useState<string[]>(() => initialRanking(trip));
  const opened = useRef(trip.rev);
  const touched = useRef(false);
  const ids = useMemo(() => initialRanking(trip).join('|'), [trip]);
  useEffect(() => {
    // Options changed under us: keep my order for what is left, append the new ones.
    setRanking((r) => {
      const open = ids.split('|').filter(Boolean);
      const kept = r.filter((id) => open.includes(id));
      return [...kept, ...open.filter((id) => !kept.includes(id))];
    });
    if (!touched.current) opened.current = trip.rev;
  }, [ids, trip.rev]);
  const label = (id: string) => trip.options.find((o) => o.id === id)?.label ?? id;
  const change = (fn: (r: string[]) => string[]) => {
    touched.current = true;
    setRanking(fn);
  };
  return (
    <section className="lv-card" aria-labelledby="vote-h" data-testid="trip-vote">
      <h2 id="vote-h" className="lv-sec__title">
        <LvIcon name="vote" size={16} /> Rank your favourites
      </h2>
      <p className="lv-sec__hint" data-testid="trip-vote-note">
        Votes are secret. Counts appear once 3 members have voted.
      </p>
      {trip.voteProgress && (
        <p className="lv-card__line" data-testid="trip-vote-progress">
          {trip.voteProgress.voted} of {trip.voteProgress.of} have voted
        </p>
      )}
      <ol className="lv-opts">
        {ranking.map((id, i) => (
          <li key={id} className="lv-opt lv-opt--rank">
            <span className="lv-opt__rank" aria-hidden="true">
              {i + 1}
            </span>
            <div className="lv-opt__main">
              <h3 className="lv-opt__name">{label(id)}</h3>
            </div>
            {trip.can.vote && (
              <div className="lv-opt__move" role="group" aria-label={`Rank ${label(id)}`}>
                <button
                  type="button"
                  className="lv-mv"
                  disabled={i === 0}
                  aria-label={`Move ${label(id)} up`}
                  onClick={() => change((r) => move(r, i, i - 1))}
                >
                  <LvIcon name="chevron-down" size={18} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  type="button"
                  className="lv-mv"
                  disabled={i === ranking.length - 1}
                  aria-label={`Move ${label(id)} down`}
                  onClick={() => change((r) => move(r, i, i + 1))}
                >
                  <LvIcon name="chevron-down" size={18} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {trip.can.vote ? (
        <div className="lv-trip__cta">
          <Button
            variant="primary"
            size="lg"
            data-testid="trip-submit-vote"
            loading={busy === 'vote'}
            disabled={busy === 'vote' || ranking.length === 0}
            onClick={() => actions.vote(ranking, opened.current)}
          >
            {trip.myVote ? 'Update my ranking' : 'Submit my ranking'}
          </Button>
        </div>
      ) : (
        trip.myVote && <p className="lv-card__foot">Your ranking is in. Only you can see it.</p>
      )}
    </section>
  );
}

/* ---------- confirming ---------- */

function ConfirmCard({
  trip,
  chosenOpt,
  busy,
  actions,
}: {
  trip: TripViewV2;
  chosenOpt?: TripOptionV2;
  busy: string | null;
  actions: TripActions;
}) {
  const id = trip.chosen?.optionId;
  return (
    <section className="lv-card" aria-labelledby="conf-h" data-testid="trip-confirm">
      <h2 id="conf-h" className="lv-sec__title">
        <LvIcon name="check" size={16} /> Confirm the trip
      </h2>
      <p className="lv-card__line" data-testid="trip-chosen">
        {chosenOpt?.label ?? 'The chosen option'}
        {trip.chosen?.dates ? `, ${trip.chosen.dates}` : ''}
        {chosenOpt?.estCost ? ` · ${chosenOpt.estCost}` : ''}
      </p>
      {trip.can.confirm && (
        <div className="lv-trip__donebtns">
          <Button
            variant="primary"
            data-testid="trip-confirm-yes"
            loading={busy === 'confirm'}
            onClick={() => actions.confirm(id, true, trip.rev)}
          >
            Confirm
          </Button>
          <Button
            variant="secondary"
            data-testid="trip-confirm-no"
            disabled={busy === 'confirm'}
            onClick={() => actions.confirm(id, false, trip.rev)}
          >
            Not for me
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---------- recommendation ---------- */

function Recommendation({ trip }: { trip: TripViewV2 }) {
  const r = trip.recommendation!;
  const label = r.optionId ? trip.options.find((o) => o.id === r.optionId)?.label : undefined;
  return (
    <section className="lv-card" aria-labelledby="rec-h" data-testid="trip-recommendation">
      <h2 id="rec-h" className="lv-card__title">
        <LvIcon name="sparkle" size={16} /> Council recommendation
        <span
          className="lv-tag lv-tag--mode"
          data-mode={r.mode}
          data-testid="trip-rec-mode"
          title={MODE_TITLE[r.mode]}
          aria-label={MODE_TITLE[r.mode]}
        >
          {r.mode}
        </span>
      </h2>
      {label && <p className="lv-card__line">Pick: {label}</p>}
      <p className="lv-card__line" data-testid="trip-rec-chair">
        <strong>Chair:</strong> {r.chair}
      </p>
      <p className="lv-card__line" data-testid="trip-rec-planner">
        <strong>Planner:</strong> {r.planner}
      </p>
      {r.dissent.length > 0 && (
        <div data-testid="trip-rec-dissent">
          <h3 className="lv-card__sub">Dissent</h3>
          <ul className="lv-limits__notes">
            {r.dissent.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---------- constraints ---------- */

function Constraints({
  trip,
  busy,
  actions,
}: {
  trip: TripViewV2;
  busy: string | null;
  actions: TripActions;
}) {
  const c = trip.constraints;
  const byId = (id: string): TripMember | undefined => trip.members.find((m) => m.id === id);
  let body: ReactNode;
  if (c.state === 'pending')
    body = <p className="lv-card__line">Waiting to check free days and budgets.</p>;
  else if (c.state === 'running')
    body = <p className="lv-card__line">Agents are checking free days and budgets.</p>;
  else if (c.state === 'waiting')
    body = (
      <div data-testid="trip-waiting">
        {c.waitingFor.map((w) => {
          const noAgent = byId(w.id)?.agent === 'no_agent';
          return (
            <div key={w.id} className="lv-trip__wait">
              <p className="lv-card__line" data-testid={`trip-waiting-${w.id}`}>
                {noAgent
                  ? `${w.name} has no agent connected yet`
                  : `${w.name}'s agent is offline, trip waits for ${w.name}`}
              </p>
              <p className="lv-card__foot">
                {noAgent
                  ? `Ask ${w.name} to connect an agent, or the organizer can continue without it.`
                  : `Open Squad on ${w.name}'s device to bring their agent back, or the organizer can continue without their agent.`}
              </p>
            </div>
          );
        })}
        <div className="lv-trip__donebtns">
          {trip.can.retry && (
            <Button
              variant="secondary"
              data-testid="trip-retry"
              loading={busy === 'retry'}
              onClick={() => actions.act('retry')}
            >
              Retry
            </Button>
          )}
          {trip.can.continueWithout && (
            <Button
              variant="ghost"
              data-testid="trip-continue"
              loading={busy === 'continue'}
              onClick={() => actions.act('continue')}
            >
              Continue without
            </Button>
          )}
        </div>
        {trip.can.continueWithout && (
          <p className="lv-card__foot" data-testid="trip-continue-warning">
            Calendars and budgets will not be checked for the members who are missing.
          </p>
        )}
      </div>
    );
  else if (c.state === 'done') body = null;
  else
    body = (
      <p className="lv-card__line">
        {c.note ??
          (c.state === 'skipped'
            ? 'Checks were skipped for this trip.'
            : 'The checks could not finish.')}
      </p>
    );
  return (
    <section
      className="lv-card"
      aria-labelledby="cons-h"
      data-testid="trip-constraints"
      data-state={c.state}
    >
      <h2 id="cons-h" className="lv-card__title">
        <LvIcon name="shield" size={16} /> Free days and budgets
        <span className="lv-tag" data-testid="trip-constraints-state">
          {c.state}
        </span>
      </h2>
      {body}
      {c.overlapDays !== null && (
        <div data-testid="trip-overlap">
          <h3 className="lv-card__sub">Free days for everyone</h3>
          {c.overlapDays.length > 0 ? (
            <ul className="lv-limits__notes" data-testid="trip-overlap-days">
              {c.overlapDays.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="lv-card__line">No days overlap yet</p>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- people ---------- */

function Members({ trip, me }: { trip: TripViewV2; me: string }) {
  return (
    <section className="lv-card" aria-labelledby="mem-h" data-testid="trip-members">
      <h2 id="mem-h" className="lv-card__title">
        <LvIcon name="users" size={16} /> Squad
      </h2>
      <ul className="lv-people">
        {trip.members.map((m) => (
          <li
            key={m.id}
            className="lv-person lv-person--chip"
            data-testid={`trip-member-${m.id}`}
            data-on={m.confirmed || undefined}
            data-agent={m.agent}
          >
            <Avatar name={m.name} size={32} tone={m.id === me ? 'you' : 'other'} />
            <span className="lv-person__name">
              {m.name}
              {m.id === me ? ' (you)' : ''}
              {m.isOrganizer && <span className="lv-tag lv-tag--lead">Organizer</span>}
            </span>
            <span className="lv-person__state" data-agent={m.agent}>
              {agentLabel[m.agent]}
              {m.voted === true ? ' · Voted' : ''}
              {m.confirmed ? ' · Confirmed' : m.declined ? ' · Declined' : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Limits({ limits }: { limits: Record<string, string> }) {
  return (
    <section className="lv-card lv-limits" aria-labelledby="lim-h" data-testid="trip-limits">
      <h2 id="lim-h" className="lv-card__title">
        <LvIcon name="lock" size={16} /> Your private limits
      </h2>
      <ul className="lv-limits__notes">
        {Object.entries(limits).map(([k, v]) => (
          <li key={k}>
            {k}: {/^\d+(\.\d+)?$/.test(v) ? money(Number(v)) : v}
          </li>
        ))}
      </ul>
      <p className="lv-card__foot">Only you can see this. It is never sent to the group.</p>
    </section>
  );
}

function Activity({ trip }: { trip: TripViewV2 }) {
  const recent = trip.changes.slice(-5).reverse();
  return (
    <section className="lv-card" aria-labelledby="act-h" data-testid="trip-activity">
      <h2 id="act-h" className="lv-card__title">
        <LvIcon name="clock" size={16} /> Activity
      </h2>
      {recent.length === 0 ? (
        <p className="lv-card__empty">No changes yet.</p>
      ) : (
        <ul className="lv-limits__notes">
          {recent.map((c) => (
            <li key={`${c.rev}-${c.at}`}>{c.summary}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TripSkeleton() {
  return (
    <div className="lv-trip__grid" role="status" aria-busy="true" data-testid="trip-loading">
      <span className="lv-vh">Loading the trip</span>
      <div className="lv-trip__main">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} shape="block" height={96} />
        ))}
      </div>
      <div className="lv-trip__side">
        {[0, 1].map((i) => (
          <Skeleton key={i} shape="block" height={140} />
        ))}
      </div>
    </div>
  );
}
