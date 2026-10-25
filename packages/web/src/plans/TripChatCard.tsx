import { useEffect, useState } from 'react';
import type { TripViewV2 } from '@squad/core';
import { timedFetch } from '../lib/http';
import { tripCardStatus, tripTruth } from '../lib/truth-labels';
import { parseTripView } from '../pages/trip/model';
import { PlanCard } from './PlanCard';
import { revisionsOf } from './dedupe';
import { usePlanActions } from './context';
import type { ChatCard } from '@squad/core';

type TripCard = Extract<ChatCard, { type: 'trip' }>;

/** privacy line for a trip: never names who voted unless the hub already revealed participation (3+ voters). */
export function tripPrivacyLine(t: TripViewV2): string {
  const base = 'Private constraints stay private.';
  if (t.status === 'voting' && t.voteProgress)
    return `${base} ${t.voteProgress.voted} of ${t.voteProgress.of} voted; choices stay hidden until the reveal.`;
  if (t.status === 'voting') return `${base} Votes are secret until the reveal.`;
  return base;
}

export function TripChatCard({
  hub,
  card,
}: {
  hub: { hubUrl: string; token: string | null } | null;
  card: TripCard;
}) {
  const [trip, setTrip] = useState<TripViewV2 | null>(null);
  const actions = usePlanActions();
  useEffect(() => {
    let dead = false;
    if (!hub) return;
    timedFetch(`${hub.hubUrl}/v1/trips/${encodeURIComponent(card.tripId)}`, {
      headers: hub.token ? { Authorization: `Bearer ${hub.token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const v = j ? parseTripView(j) : undefined;
        if (!dead && v) setTrip(v);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [hub?.hubUrl, hub?.token, card.tripId, card.rev, card.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = trip?.title ?? 'Group trip';
  const status = trip ? tripCardStatus(trip) : (card.status ?? 'Planning');
  const truth = trip
    ? tripTruth({
        planner: trip.recommendation?.mode ?? null,
        agents: trip.members.map((m) => m.agent),
      })
    : null;
  const open = () => actions?.openPlan({ kind: 'trip', id: card.tripId });
  const organizer = trip?.members.find((m) => m.isOrganizer)?.name;
  const chosen = trip?.chosen
    ? trip.options.find((o) => o.id === trip.chosen!.optionId)
    : undefined;
  return (
    <PlanCard
      kind="trip"
      planId={card.tripId}
      title={title}
      status={status}
      author={organizer ? `Started by ${organizer}` : undefined}
      updatedAt={trip?.constraints.checkedAt ?? undefined}
      provenance={truth ? { label: truth.label, reason: truth.reason, tone: truth.state } : null}
      privacy={trip ? tripPrivacyLine(trip) : 'Private constraints stay private.'}
      revisions={revisionsOf(card)}
      actions={{
        edit: (
          <button type="button" className="sqp-btn" data-testid="plan-edit" onClick={open}>
            Edit
          </button>
        ),
        ...(trip?.can.vote || trip?.can.confirm
          ? {
              vote: (
                <button
                  type="button"
                  className="sqp-btn sqp-btn--primary"
                  data-testid="plan-vote"
                  onClick={open}
                >
                  {trip.can.confirm ? 'Confirm' : 'Vote'}
                </button>
              ),
            }
          : {}),
        ask: () => actions?.askCubbie({ id: card.tripId, label: title }),
      }}
    >
      {trip ? (
        <p className="sqp-card__meta" data-testid="plan-card-summary">
          {chosen
            ? `Agreed: ${chosen.label}${trip.chosen?.dates ? `, ${trip.chosen.dates}` : ''}`
            : `${trip.options.filter((o) => !o.droppedReason).length} options`}
          {trip.window ? ` · ${trip.window.from} to ${trip.window.to}` : ''}
        </p>
      ) : null}
    </PlanCard>
  );
}
