import { useEffect, useMemo, useState } from 'react';
import { ConfirmSheet } from '../../overlays/ConfirmSheet';
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
  initialRanking,
  money,
  move,
  showVoteCounts,
  splitTotal,
  type TripOption,
  type TripState,
} from './model';
import './trip.css';

export type TripStatus = 'loading' | 'ready' | 'error' | 'offline';

export interface TripViewProps {
  status: TripStatus;
  connection: Connection;
  trip?: TripState;
  /** Signed-in student id (marks "You" in confirmations). */
  me: string;
  onSubmitVote: (ranking: string[]) => void;
  onConfirm: (optionId: string, yes: boolean) => void;
  /** Seconds to wait on the confirmed banner before opening the village cutscene; 0 disables the auto jump. */
  cutsceneDelaySec?: number;
  /** Fired once when the trip becomes confirmed (open the village cutscene). */
  onTripConfirmed?: (tripId: string) => void;
  onRetry?: () => void;
  submitting?: 'vote' | 'confirm' | null;
  /** Open the confirm sheet on mount (gallery). */
  confirmOpen?: boolean;
}

export function TripView(props: TripViewProps) {
  const {
    status,
    connection,
    trip,
    me,
    onSubmitVote,
    onConfirm,
    onRetry,
    onTripConfirmed,
    submitting = null,
  } = props;
  const delay = props.cutsceneDelaySec ?? 3;

  return (
    <Page
      className="lv-trip"
      eyebrow="Plan together"
      title={trip?.title ?? 'Trip planner'}
      actions={<ConnectionBadge connection={connection} />}
    >
      <p className="lv-lede">
        Everyone&rsquo;s limits stay private. Your agent finds what works and only shares what has
        to be shared.
      </p>
      {status === 'loading' && <TripSkeleton />}
      {status === 'error' && (
        <StateBlock
          kind="error"
          title="The trip did not load"
          body="The hub did not answer. Your answers are safe; try again."
          onRetry={onRetry}
        />
      )}
      {status === 'offline' && (
        <StateBlock
          kind="offline"
          title="You are offline"
          body="Votes and confirmations wait until your connection is back."
          onRetry={onRetry}
          retryLabel="Check again"
        />
      )}
      {status === 'ready' && !trip && (
        <StateBlock
          kind="empty"
          art="map"
          title="No trip yet"
          body="When your squad starts planning, the options show up here."
        />
      )}
      {status === 'ready' && trip && (
        <TripBody
          trip={trip}
          me={me}
          onSubmitVote={onSubmitVote}
          onConfirm={onConfirm}
          delay={delay}
          onTripConfirmed={onTripConfirmed}
          submitting={submitting}
          confirmOpen={props.confirmOpen}
        />
      )}
    </Page>
  );
}

function TripBody({
  trip,
  me,
  onSubmitVote,
  onConfirm,
  delay,
  onTripConfirmed,
  submitting,
  confirmOpen,
}: {
  trip: TripState;
  me: string;
  onSubmitVote: (r: string[]) => void;
  onConfirm: (id: string, yes: boolean) => void;
  delay: number;
  onTripConfirmed?: (id: string) => void;
  submitting: 'vote' | 'confirm' | null;
  confirmOpen?: boolean;
}) {
  const open = useMemo(() => trip.options.filter((o) => !o.vetoed), [trip.options]);
  const vetoed = trip.options.filter((o) => o.vetoed);
  const [ranking, setRanking] = useState<string[]>(() => initialRanking(trip.options));
  const [sheet, setSheet] = useState(confirmOpen ?? false);
  const [stay, setStay] = useState(false);
  const byId = (id: string) => trip.options.find((o) => o.id === id);
  const chosen = trip.leadingOptionId ? byId(trip.leadingOptionId) : undefined;
  const mine = trip.members.find((m) => m.id === me);
  const people = trip.members.length;
  const counts = showVoteCounts(people);
  const shares = chosen ? splitTotal(chosen.total, people) : [];

  // keep the ranking in sync if options change (an option got vetoed)
  useEffect(() => {
    setRanking((r) => {
      const ids = open.map((o) => o.id);
      const kept = r.filter((id) => ids.includes(id));
      return [...kept, ...ids.filter((id) => !kept.includes(id))];
    });
  }, [open]);

  // Hand off to the village trip cutscene once, when everyone has confirmed.
  useEffect(() => {
    if (!trip.confirmed || !onTripConfirmed || delay <= 0 || stay) return;
    const t = setTimeout(() => onTripConfirmed(trip.tripId), delay * 1000);
    return () => clearTimeout(t);
  }, [trip.confirmed, trip.tripId, onTripConfirmed, delay, stay]);

  return (
    <>
      {trip.confirmed && (
        <section className="lv-trip__done" role="status" aria-live="polite">
          <img
            className="sq-sprite"
            src={propArt.van.url}
            width={propArt.van.w}
            height={propArt.van.h}
            alt=""
          />
          <div>
            <h2>Trip confirmed{chosen ? `: ${chosen.name}` : ''}</h2>
            <p>
              Everyone said yes.{' '}
              {delay > 0 && !stay ? 'Opening the village in a moment.' : 'The van is packed.'}
            </p>
          </div>
          <div className="lv-trip__donebtns">
            <Button
              variant="primary"
              iconEnd="arrow-right"
              onClick={() => onTripConfirmed?.(trip.tripId)}
            >
              Watch in the village
            </Button>
            {delay > 0 && !stay && (
              <Button variant="ghost" onClick={() => setStay(true)}>
                Stay here
              </Button>
            )}
          </div>
        </section>
      )}

      <div className="lv-trip__grid">
        <section className="lv-trip__main" aria-labelledby="opts-h">
          <div className="lv-sec__head">
            <h2 id="opts-h" className="lv-sec__title">
              Options
            </h2>
            <p className="lv-sec__hint">
              {trip.iVoted
                ? 'Your ranking is in. Only you can see it.'
                : 'Rank your favourites. Nobody sees your order.'}
            </p>
          </div>
          <ol className="lv-opts">
            {ranking.map((id, i) => {
              const o = byId(id);
              if (!o) return null;
              return (
                <Opt
                  key={o.id}
                  o={o}
                  rank={i + 1}
                  leading={o.id === trip.leadingOptionId}
                  locked={trip.iVoted || trip.confirmed}
                  canUp={i > 0}
                  canDown={i < ranking.length - 1}
                  onUp={() => setRanking((r) => move(r, i, i - 1))}
                  onDown={() => setRanking((r) => move(r, i, i + 1))}
                />
              );
            })}
            {vetoed.map((o) => (
              <Opt
                key={o.id}
                o={o}
                locked
                canUp={false}
                canDown={false}
                onUp={() => {}}
                onDown={() => {}}
              />
            ))}
          </ol>
          {!trip.iVoted && !trip.confirmed && (
            <div className="lv-trip__cta">
              <Button
                variant="primary"
                size="lg"
                loading={submitting === 'vote'}
                disabled={submitting === 'vote' || ranking.length === 0}
                onClick={() => onSubmitVote(ranking)}
              >
                {submitting === 'vote' ? 'Sending' : 'Submit my ranking'}
              </Button>
            </div>
          )}
        </section>

        <aside className="lv-trip__side">
          <section className="lv-card lv-limits" aria-labelledby="lim-h">
            <h2 id="lim-h" className="lv-card__title">
              <LvIcon name="lock" size={16} /> Your private limits
            </h2>
            {trip.myLimits ? (
              <>
                <p className="lv-limits__budget">
                  <span>Budget</span>
                  <strong>up to {money(trip.myLimits.budget)}</strong>
                </p>
                <ul className="lv-limits__notes">
                  {trip.myLimits.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="lv-card__empty">
                No limits set. Your agent will not filter anything for you.
              </p>
            )}
            <p className="lv-card__foot">Only you see this. It is never sent to the group.</p>
          </section>

          <section className="lv-card" aria-labelledby="vote-h">
            <h2 id="vote-h" className="lv-card__title">
              <LvIcon name="vote" size={16} /> Secret vote
            </h2>
            {counts ? (
              <>
                <div
                  className="lv-pips"
                  role="img"
                  aria-label={`${trip.voted} of ${people} have voted`}
                >
                  {trip.members.map((m, i) => (
                    <span key={m.id} className="lv-pip" data-on={i < trip.voted || undefined} />
                  ))}
                </div>
                <p className="lv-card__line">
                  {trip.voted} of {people} have voted
                </p>
              </>
            ) : (
              <p className="lv-card__line">
                Votes are collected privately. Results show once everyone has voted.
              </p>
            )}
            <p className="lv-card__foot">Nobody sees who voted for what.</p>
          </section>

          <section className="lv-card" aria-labelledby="conf-h">
            <h2 id="conf-h" className="lv-card__title">
              <LvIcon name="check" size={16} /> Confirmations
            </h2>
            <ul className="lv-people">
              {trip.members.map((m) => (
                <li key={m.id} className="lv-person" data-on={m.confirmed || undefined}>
                  <Avatar name={m.name} size={32} tone={m.id === me ? 'you' : 'other'} />
                  <span className="lv-person__name">
                    {m.name}
                    {m.id === me ? ' (you)' : ''}
                  </span>
                  <span className="lv-person__state">
                    <LvIcon name={m.confirmed ? 'check' : 'clock'} size={16} />
                    {m.confirmed ? 'Confirmed' : 'Waiting'}
                  </span>
                </li>
              ))}
            </ul>
            {!trip.confirmed && chosen && mine && !mine.confirmed && (
              <Button variant="primary" className="lv-card__btn" onClick={() => setSheet(true)}>
                Confirm {chosen.name}
              </Button>
            )}
            {!trip.confirmed && !chosen && (
              <p className="lv-card__foot">Confirmations open once the squad has a front runner.</p>
            )}
          </section>

          {chosen && (
            <section className="lv-card" aria-labelledby="split-h">
              <h2 id="split-h" className="lv-card__title">
                <LvIcon name="split" size={16} /> Split
              </h2>
              <p className="lv-split__sum">
                {money(chosen.total)}{' '}
                <span>
                  for {chosen.name}, shared by {people}
                </span>
              </p>
              <ul className="lv-split">
                {trip.members.map((m, i) => (
                  <li key={m.id}>
                    <span>{m.name}</span>
                    <span>{money(shares[i] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {chosen && (
        <ConfirmSheet
          open={sheet}
          fixed
          onClose={() => setSheet(false)}
          question={`Confirm ${chosen.name}, ${chosen.dates}?`}
          details={[
            { label: 'Shares', value: `${chosen.name}, ${chosen.dates}`, tone: 'shared' },
            { label: 'Shares', value: 'Your yes', tone: 'shared' },
            { label: 'Keeps private', value: 'Your budget and your other plans', tone: 'private' },
          ]}
          phase={submitting === 'confirm' ? 'submitting' : mine?.confirmed ? 'done' : 'idle'}
          onChoose={(opt, i) => {
            onConfirm(chosen.id, i === 0);
            if (i !== 0) setSheet(false);
          }}
        />
      )}
    </>
  );
}

function Opt({
  o,
  rank,
  leading,
  locked,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  o: TripOption;
  rank?: number;
  leading?: boolean;
  locked: boolean;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <li className="lv-opt" data-vetoed={o.vetoed || undefined} data-leading={leading || undefined}>
      <span className="lv-opt__rank" aria-hidden="true">
        {o.vetoed ? <LvIcon name="x" size={16} /> : rank}
      </span>
      <div className="lv-opt__main">
        <h3 className="lv-opt__name">
          {o.name}
          {leading && <span className="lv-tag lv-tag--lead">Front runner</span>}
        </h3>
        <p className="lv-opt__meta">
          {o.dates} <span aria-hidden="true">·</span> {money(o.total)} total
        </p>
        <p className="lv-opt__fit" data-fit={o.vetoed ? 'veto' : o.fits ? 'yes' : 'no'}>
          {o.vetoed ? (
            <>
              <LvIcon name="x" size={14} /> Dropped by the mediator. Someone&rsquo;s limit rules it
              out.
            </>
          ) : o.fits ? (
            <>
              <LvIcon name="check" size={14} /> Fits your limits
            </>
          ) : (
            <>
              <LvIcon name="alert" size={14} /> Over one of your limits
            </>
          )}
        </p>
      </div>
      {!o.vetoed && (
        <div className="lv-opt__move" role="group" aria-label={`Rank ${o.name}`}>
          <button
            type="button"
            className="lv-mv"
            onClick={onUp}
            disabled={locked || !canUp}
            aria-label={`Move ${o.name} up`}
          >
            <LvIcon name="chevron-down" size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            type="button"
            className="lv-mv"
            onClick={onDown}
            disabled={locked || !canDown}
            aria-label={`Move ${o.name} down`}
          >
            <LvIcon name="chevron-down" size={18} />
          </button>
        </div>
      )}
    </li>
  );
}

function TripSkeleton() {
  return (
    <div className="lv-trip__grid" role="status" aria-busy="true">
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
