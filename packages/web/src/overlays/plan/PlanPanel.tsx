import { useId, useState } from 'react';
import {
  planBadge,
  type PlanItem,
  type PlanItemFields,
  type PlanItemPatch,
  type PlanView,
} from '@squad/core';
import { LvIcon, OverlayFrame } from '../kit';
import {
  MODE_LABEL,
  MODE_TEXT,
  STATUS_WORD,
  dayLabel,
  groupByDate,
  minutesWords,
  savedWords,
  syncWords,
  type PlanStatus,
} from './model';
import './plan.css';

export interface PlanPanelProps {
  open: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  calm?: boolean;
  plan: PlanView | null | undefined;
  status: PlanStatus;
  /** One plain sentence about the last action (saved, conflict, failure). */
  notice?: string | undefined;
  busy?: boolean;
  onRespond: (r: 'accept' | 'decline') => void;
  onConfirm: () => void;
  onEdit: (item: PlanItem, patch: PlanItemPatch) => void;
  onResolve: (conflictId: string, pick: 'theirs' | 'mine') => void;
  onDone: (item: PlanItem, done: boolean) => void;
  /** Sends a chat phrase to the squad chat; absent in replays. */
  onAsk?: (phrase: string) => void;
  onRetry?: () => void;
  /** Starts the real planner flow for an exam day (`YYYY-MM-DD`); absent in replays. */
  onPropose?: (examDate: string) => void;
  /** Clock for the "x min ago" words (tests). */
  now?: number;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function ProposeForm({
  busy,
  onPropose,
}: {
  busy?: boolean | undefined;
  onPropose: (d: string) => void;
}) {
  const [date, setDate] = useState(() => inDays(14));
  return (
    <form
      className="pl-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onPropose(date);
      }}
    >
      <label>
        Exam day
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="plan-propose-date"
        />
      </label>
      <button
        type="submit"
        className="lv-btn lv-btn--primary"
        data-testid="plan-propose"
        disabled={busy || !date}
      >
        {busy ? 'Building the plan...' : 'Propose a plan'}
      </button>
    </form>
  );
}

const fieldsText = (f: PlanItemFields, name: (id: string) => string) =>
  `${name(f.ownerId)}, ${dayLabel(f.date)}, ${minutesWords(f.durationMin)}`;

function EditForm(props: {
  item: PlanItem;
  plan: PlanView;
  onSave: (p: PlanItemPatch) => void;
  onCancel: () => void;
}) {
  const { item, plan, onSave, onCancel } = props;
  const [date, setDate] = useState(item.date);
  const [owner, setOwner] = useState(item.ownerId);
  const [mins, setMins] = useState(String(item.durationMin));
  const save = () => {
    const patch: PlanItemPatch = {};
    if (date && date !== item.date) patch.date = date;
    if (owner !== item.ownerId) patch.ownerId = owner;
    const n = Number(mins);
    if (Number.isFinite(n) && n !== item.durationMin) patch.durationMin = Math.round(n);
    if (Object.keys(patch).length === 0) return onCancel();
    onSave(patch);
  };
  return (
    <form
      className="pl-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        Day
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="plan-edit-date"
        />
      </label>
      <label>
        Owner
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          data-testid="plan-edit-owner"
        >
          {plan.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Minutes
        <input
          type="number"
          min={10}
          max={480}
          step={5}
          value={mins}
          onChange={(e) => setMins(e.target.value)}
          data-testid="plan-edit-minutes"
        />
      </label>
      <button type="submit" className="lv-btn lv-btn--primary" data-testid="plan-save">
        Save
      </button>
      <button type="button" className="lv-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/**
 * The in-world Study Plan panel, docked like the Mastery panel. One shared plan: who owns what, when, the exam
 * countdown, conflicts and the accept/edit controls. Plain words and counts only; never a score.
 */
export function PlanPanel(props: PlanPanelProps) {
  const { open, onClose, returnFocusTo, calm, plan, status, notice, busy } = props;
  const titleId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const nameOf = (id: string) => plan?.members.find((m) => m.id === id)?.name ?? id;
  const openConflicts = plan?.conflicts.filter((c) => c.status === 'open') ?? [];
  const busyIds = new Set(plan?.availability.mine.filter((a) => a.busy).map((a) => a.itemId));
  const inactive = plan?.status === 'cancelled' || plan?.status === 'failed';

  return (
    <OverlayFrame
      open={open}
      dock="plan"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      calm={calm}
      labelledBy={titleId}
      placement="dock"
      size="md"
      className="rr-panel lv-mpanel pl-panel"
    >
      <span className="lv-grip" aria-hidden="true" />
      <button type="button" className="lv-btn lv-close" onClick={onClose} aria-label="Close">
        <LvIcon name="x" size={20} />
      </button>
      <div className="rr-panel__body">
        <header className="rr-panel__head">
          <h2 id={titleId} className="rr-panel__title">
            Study plan
          </h2>
          <p className="rr-panel__tagline">
            One plan for the whole squad. Everyone sees who owns what; nobody sees your calendar.
          </p>
        </header>

        {status === 'loading' && !plan && (
          <p className="rr-sec__p rr-dim" role="status">
            Loading the plan...
          </p>
        )}
        {(status === 'error' || status === 'offline') && (
          <div className="pl-note" role="alert" data-testid="plan-error">
            <p>
              {status === 'offline'
                ? 'You are offline. The plan will refresh when you reconnect.'
                : 'The plan could not be loaded.'}
            </p>
            {props.onRetry && (
              <button type="button" className="lv-btn" onClick={props.onRetry}>
                Try again
              </button>
            )}
          </div>
        )}

        {status !== 'loading' && !plan && status === 'ready' && (
          <section className="rr-sec" data-testid="plan-empty">
            <h3 className="rr-sec__h">No study plan yet</h3>
            <p className="rr-sec__p rr-dim">
              Propose one here or ask Cubbie in the group chat, for example "@cubbie study plan for
              the exam on 10 Nov". The whole squad gets the proposal to accept.
            </p>
            {props.onPropose && <ProposeForm busy={busy} onPropose={props.onPropose} />}
            {busy && (
              <p className="rr-sec__p" role="status" data-testid="plan-building">
                Building the plan...
              </p>
            )}
            {notice && (
              <p className="pl-note" role="alert" data-testid="plan-notice">
                {notice}
              </p>
            )}
            {props.onAsk && (
              <button
                type="button"
                className="lv-btn lv-btn--primary"
                data-testid="plan-ask"
                onClick={() => {
                  props.onAsk?.('@cubbie study plan');
                  onClose();
                }}
              >
                Ask Cubbie to plan
              </button>
            )}
          </section>
        )}

        {plan && (
          <>
            <div className="pl-ribbon">
              <strong data-testid="plan-countdown">
                {plan.countdown ? plan.countdown.words : 'No exam date set'}
              </strong>
              <span className="rr-dim">
                {plan.examLabel}
                {plan.examDate ? `, ${dayLabel(plan.examDate)}` : ''}
              </span>
            </div>
            <p className="pl-status">
              <span data-testid="plan-status">{STATUS_WORD[plan.status] ?? plan.status}</span>
              {' · '}
              <span data-testid="plan-progress">{plan.progress.words}</span>
              {' · '}
              <span
                className={`pl-badge pl-badge--${plan.generator.mode}`}
                data-testid="plan-mode"
                title={MODE_TEXT[plan.generator.mode]}
              >
                {MODE_LABEL[plan.generator.mode]}
              </span>
            </p>
            <p className="rr-dim pl-mode-text">{MODE_TEXT[plan.generator.mode]}</p>
            <p className="pl-status">
              <span
                className={`pl-badge pl-badge--${plan.generator.mode}`}
                data-testid="plan-mode-badge"
                data-mode={plan.generator.mode}
              >
                {planBadge(plan.generator).label}
              </span>{' '}
              <span className="rr-dim" data-testid="plan-kind">
                {planBadge(plan.generator).kindLabel}
              </span>
            </p>
            <p className="rr-dim" data-testid="plan-saved">
              {savedWords(plan, props.now ?? Date.now(), nameOf)}
            </p>
            <p className="rr-dim" data-testid="plan-sync">
              {syncWords(plan, props.now ?? Date.now())}
            </p>
            {plan.rationale && (
              <p className="rr-sec__p" data-testid="plan-rationale">
                {plan.rationale}
              </p>
            )}
            {plan.error && (
              <p className="pl-note" role="alert">
                {plan.error}
              </p>
            )}
            {notice && (
              <p className="pl-note" role="status" data-testid="plan-notice">
                {notice}
              </p>
            )}

            {openConflicts.map((c) => {
              const it = plan.items.find((i) => i.id === c.itemId);
              return (
                <div key={c.id} className="pl-conflict" role="alert" data-testid="plan-conflict">
                  <strong>Two edits to "{it?.title ?? 'an item'}" collided.</strong>
                  <p>
                    <span data-testid="plan-theirs">
                      {nameOf(c.theirsBy)} set: {fieldsText(c.theirs, nameOf)}
                    </span>
                  </p>
                  <p>
                    <span data-testid="plan-mine">
                      {nameOf(c.mineBy)} wanted: {fieldsText(c.mine, nameOf)}
                    </span>
                  </p>
                  <div className="pl-row">
                    <button
                      type="button"
                      className="lv-btn"
                      data-testid="plan-pick-theirs"
                      disabled={busy}
                      onClick={() => props.onResolve(c.id, 'theirs')}
                    >
                      Keep theirs
                    </button>
                    <button
                      type="button"
                      className="lv-btn lv-btn--primary"
                      data-testid="plan-pick-mine"
                      disabled={busy}
                      onClick={() => props.onResolve(c.id, 'mine')}
                    >
                      Use mine
                    </button>
                  </div>
                </div>
              );
            })}

            {plan.status === 'proposed' && (
              <section className="rr-sec" aria-label="Your answer">
                <p className="rr-sec__p">
                  {plan.members.filter((m) => m.optedIn && m.response === 'accepted').length} of{' '}
                  {plan.members.filter((m) => m.optedIn).length} accepted.{' '}
                  {plan.me.response === 'pending'
                    ? 'Do you want in?'
                    : plan.me.response === 'accepted'
                      ? 'You accepted.'
                      : 'You declined.'}
                </p>
                <div className="pl-row">
                  <button
                    type="button"
                    className="lv-btn lv-btn--primary"
                    data-testid="plan-accept"
                    disabled={busy || plan.me.response === 'accepted'}
                    onClick={() => props.onRespond('accept')}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="lv-btn"
                    data-testid="plan-decline"
                    disabled={busy || plan.me.response === 'declined'}
                    onClick={() => props.onRespond('decline')}
                  >
                    Decline
                  </button>
                  {plan.me.isOrganizer && (
                    <button
                      type="button"
                      className="lv-btn"
                      data-testid="plan-confirm"
                      disabled={busy}
                      onClick={props.onConfirm}
                    >
                      Confirm plan
                    </button>
                  )}
                </div>
              </section>
            )}

            <ul className="pl-chips" aria-label="Acceptance" data-testid="plan-members">
              {plan.members.map((m) => (
                <li key={m.id} className="pl-chip" data-testid={`plan-member-${m.id}`}>
                  {m.name}: {m.response === 'pending' ? 'pending' : m.response}
                </li>
              ))}
            </ul>

            <section className="rr-sec" aria-labelledby={`${titleId}-load`}>
              <h3 id={`${titleId}-load`} className="rr-sec__h">
                Who has what
              </h3>
              <ul className="pl-load" data-testid="plan-load">
                {plan.load.map((l) => (
                  <li key={l.memberId}>
                    <strong>{l.name}</strong>: {l.items} {l.items === 1 ? 'item' : 'items'},{' '}
                    {minutesWords(l.minutes)}, {l.done} done
                  </li>
                ))}
              </ul>
              {plan.availability.squad && plan.availability.squad.length > 0 && (
                <p className="rr-dim">
                  Free time overlaps:{' '}
                  {plan.availability.squad
                    .map((d) => `${dayLabel(d.date)} (${d.free} of ${d.total} free)`)
                    .join(', ')}
                </p>
              )}
            </section>

            <section className="rr-sec" aria-labelledby={`${titleId}-tl`}>
              <h3 id={`${titleId}-tl`} className="rr-sec__h">
                Timeline
              </h3>
              {plan.items.length === 0 ? (
                <p className="rr-dim">No items yet.</p>
              ) : (
                groupByDate(plan.items).map((g) => (
                  <div key={g.date} className="pl-day" data-testid="plan-day">
                    <h4 className="pl-day__h">{dayLabel(g.date)}</h4>
                    <ul className="pl-items">
                      {g.items.map((i) => {
                        const mine = i.ownerId === plan.me.id;
                        return (
                          <li
                            key={i.id}
                            className="pl-item"
                            data-testid="plan-item"
                            data-status={i.status}
                          >
                            <div className="pl-item__head">
                              <span>
                                <strong>{i.title}</strong>{' '}
                                <span className="pl-owner" data-testid="plan-owner">
                                  {i.ownerName}
                                </span>
                              </span>
                              <span className="rr-dim">
                                {minutesWords(i.durationMin)}
                                {i.status === 'done' ? ', done' : ''}
                              </span>
                            </div>
                            {i.why && (
                              <p className="rr-dim" data-testid="plan-why">
                                {i.why}
                              </p>
                            )}
                            {mine && busyIds.has(i.id) && (
                              <p className="pl-busy" data-testid="plan-busy">
                                You look busy then. Consider moving it.
                              </p>
                            )}
                            {!inactive && (
                              <div className="pl-row">
                                <button
                                  type="button"
                                  className="lv-btn"
                                  data-testid={`plan-edit-${i.id}`}
                                  onClick={() => setEditing(editing === i.id ? null : i.id)}
                                >
                                  Edit
                                </button>
                                {mine && (
                                  <button
                                    type="button"
                                    className="lv-btn"
                                    data-testid={`plan-done-${i.id}`}
                                    disabled={busy}
                                    onClick={() => props.onDone(i, i.status !== 'done')}
                                  >
                                    {i.status === 'done' ? 'Mark not done' : 'Mark done'}
                                  </button>
                                )}
                              </div>
                            )}
                            {editing === i.id && (
                              <EditForm
                                item={i}
                                plan={plan}
                                onCancel={() => setEditing(null)}
                                onSave={(p) => {
                                  props.onEdit(i, p);
                                  setEditing(null);
                                }}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </section>

            {plan.myWeakTopics.length > 0 && (
              <p className="rr-dim" data-testid="plan-weak">
                Only you see this: your weakest chapters are {plan.myWeakTopics.join(', ')}.
              </p>
            )}

            {plan.citations.length > 0 && (
              <section className="rr-sec" aria-labelledby={`${titleId}-src`}>
                <h3 id={`${titleId}-src`} className="rr-sec__h">
                  Built from
                </h3>
                <ul className="pl-src" data-testid="plan-citations">
                  {plan.citations.map((c, i) => (
                    <li key={`${c.label}-${i}`}>{c.label}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="rr-dim pl-help">{plan.replyHelp}</p>
          </>
        )}
      </div>
    </OverlayFrame>
  );
}
