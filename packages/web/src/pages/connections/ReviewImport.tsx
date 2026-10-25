import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { plural } from '../../lib/plural';
import { CitationChip, SourceViewerHost } from '../../components/source-viewer';
import type { SourceKind } from '../../components/source-viewer';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { useSquadConfig } from '../../shell/context';
import type { Connection, SourceRow } from './api';
import { askCubbie, pickAskItems } from './askCubbie';
import { deriveProviderState, sourceChipLabel, type Provider } from './connection-state';
import { CALENDAR_KINDS, errorCopy, FIXTURE_LABEL, itemTypeLabel, countLines, kindCounts, relTime, squadLabel } from './model';
import { useConnections, type ConnectionsState } from './useConnections';
import './connections.css';

export interface ReviewImportProps {
  /** Embedded as an onboarding step: no page chrome; `onContinue` renders a Continue button. */
  embedded?: boolean;
  onContinue?: () => void;
  /** Review only one provider (onboarding step per provider). */
  provider?: Provider;
  /** Test/host injection; defaults to the live hook. */
  state?: ConnectionsState;
  now?: number;
  navigate?: (url: string) => void;
}

const providerOfKind = (k: string): Provider => (k.startsWith('canvas_') ? 'canvas' : 'google');
const where = (r: SourceRow): string | null => {
  const t = r.dueAt ?? r.startsAt;
  return t ? `${r.dueAt ? 'Due' : 'Starts'} ${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null;
};

/** Review what was imported before anything is shared: counts, citations, sharing, Ask Squad, Change source. */
export function ReviewImport(p: ReviewImportProps) {
  const live = useConnections();
  const s = p.state ?? live;
  const now = p.now ?? Date.now();
  const providers: Provider[] = p.provider ? [p.provider] : ['canvas', 'google'];
  return (
    <div className="sq-conn sq-review" data-testid="review-import">
      {!p.embedded ? (
        <p className="sq-conn__lede">
          Check what Squad imported. Everything starts Private to you. Nothing reaches your squad until
          you share it, and calendar titles are never shared.
        </p>
      ) : null}
      {s.error ? <Notice tone="error" onDismiss={s.clearError}>{errorCopy(s.error)}</Notice> : null}
      {s.view === 'loading' ? <p role="status">Loading what was imported</p> : null}
      {s.view === 'offline' ? <Notice tone="warn" title="Cannot reach the hub">Nothing was changed.</Notice> : null}
      {s.view === 'demo' ? (
        <Notice tone="info" title="Demo mode">There is nothing imported without a live hub.</Notice>
      ) : null}
      {s.view === 'ready'
        ? providers.map((pr) => (
            <ProviderReview key={pr} provider={pr} s={s} now={now} navigate={p.navigate} />
          ))
        : null}
      <div className="sq-conn__actions">
        <Link to="/squad/connections" data-testid="change-source">
          Change source
        </Link>
        {p.onContinue ? (
          <Button variant="primary" data-testid="review-continue" onClick={p.onContinue}>
            Continue
          </Button>
        ) : null}
      </div>
      <SourceViewerHost />
    </div>
  );
}

function ProviderReview({ provider, s, now, navigate }: { provider: Provider; s: ConnectionsState; now: number; navigate: ((u: string) => void) | undefined }) {
  const list = s.connections.filter((c) => c.provider === provider);
  const v = deriveProviderState(provider, list, { now, reviewed: true });
  const c: Connection | null = v.connection && v.connection.state !== 'revoked' ? v.connection : null;
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const load = useCallback(() => {
    if (c && s.client?.sources) void s.client.sources(c.id).then(setRows, () => setRows(null));
  }, [c?.id, s.client]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load, c?.lastSyncAt, c?.sources.total]);
  const name = provider === 'canvas' ? 'Canvas' : 'Google';
  const share = (patch: { sourceIds?: string[]; all?: boolean; shared: boolean }) =>
    c && s.squadId ? s.run((h) => h.share(c.id, { squadId: s.squadId!, ...patch })) : undefined;
  if (!c)
    return (
      <Card className="sq-conn__card" data-testid={`review-provider-${provider}`}>
        <div className="sq-conn__row">
          <strong>{name}</strong>
          <span data-testid={`review-state-${provider}`}><Chip>{v.label}</Chip></span>
        </div>
        <p className="sq-conn__state">{v.text}</p>
        <Link to="/squad/connections">Connect {name}</Link>
      </Card>
    );
  const courses = new Set((rows ?? []).map((r) => r.courseId).filter(Boolean)).size;
  const counts = c.counts
    ? countLines(c)
    : [
        ...(courses > 0 && !('canvas_course' in c.sources.byKind) ? [plural(courses, 'course')] : []),
        ...kindCounts(c.sources.byKind),
      ];
  const sharedAll = rows !== null && rows.some((r) => s.squadId && r.sharedWith.includes(s.squadId));
  const squadName = s.squadId ? squadLabel(s.squadId, s.squadNames) : null;
  return (
    <Card className="sq-conn__card" data-testid={`review-provider-${provider}`}>
      <div className="sq-conn__row">
        <strong>{name}</strong>
        <span data-testid={`review-state-${provider}`}>
          <Chip tone={v.state === 'demo' ? 'violet' : v.state === 'live' ? 'ok' : v.state === 'syncing' ? 'ember' : 'alert'}>{v.label}</Chip>
        </span>
      </div>
      <p className="sq-conn__state">{v.text}</p>
      {v.fixture ? (
        <p className="sq-conn__meta" data-testid={`review-fixture-note-${provider}`}>
          {FIXTURE_LABEL}: sample data from the repo, not your {name} account.
        </p>
      ) : null}
      <p className="sq-conn__meta" data-testid={`review-sync-${provider}`}>
        {c.lastSyncAt ? `Last synced ${relTime(c.lastSyncAt, now)}${c.lastOutcome ? ` (${c.lastOutcome})` : ''}` : 'No sync has completed yet'}
        {c.account && !v.fixture ? ` · ${[c.account.name, c.account.label, c.account.host].filter(Boolean).join(' · ')}` : ''}
      </p>
      <p className="sq-conn__state" data-testid={`review-counts-${provider}`}>
        {counts.length ? counts.join(', ') : '0 items'}
      </p>
      <div className="sq-conn__actions">
        <span data-testid={`review-sharing-${provider}`}>
          <Chip tone={sharedAll ? 'ember' : 'neutral'}>
            {sharedAll && squadName ? `Shared with ${squadName}` : 'Private to me'}
          </Chip>
        </span>
        {s.squadId ? (
          <>
            <Button size="sm" variant="ghost" data-testid={`review-share-all-${provider}`} onClick={() => void share({ all: true, shared: true })?.then(load)}>
              Share this source with {squadName}
            </Button>
            <Button size="sm" variant="ghost" data-testid={`review-unshare-all-${provider}`} onClick={() => void share({ all: true, shared: false })?.then(load)}>
              Make private
            </Button>
          </>
        ) : null}
        {s.squadId && rows && rows.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            iconStart="sparkle"
            data-testid={`review-ask-primary-${provider}`}
            onClick={() => askCubbie(s.squadId!, pickAskItems(rows, now), navigate)}
          >
            Ask Squad with this
          </Button>
        ) : null}
      </div>
      {rows && rows.length === 0 ? (
        <p className="sq-conn__meta" data-testid="review-empty">Nothing imported yet. Items appear after the first sync.</p>
      ) : null}
      <ul className="sq-conn__itemlist" aria-label={`${name} imported items`}>
        {(rows ?? []).map((r) => {
          const cal = CALENDAR_KINDS.has(r.kind);
          const shared = !!s.squadId && r.sharedWith.includes(s.squadId);
          const demo = r.provenance === 'fixture';
          return (
            <li key={r.id} className="sq-conn__item" data-testid="review-item" data-kind={r.kind}>
              <div className="sq-conn__itemmain">
                <CitationChip
                  citation={{
                    file: r.title,
                    page: 1,
                    source: { kind: r.kind as Exclude<SourceKind, 'pdf'>, id: r.id, title: r.title },
                    ...(r.courseId ? { courseId: r.courseId } : {}),
                  }}
                />
                <span className="sq-conn__meta">
                  {itemTypeLabel(r.kind)}
                  {r.courseName ? ` · ${r.courseName}` : ''}
                  {where(r) ? ` · ${where(r)}` : ''}
                </span>
              </div>
              <div className="sq-conn__itemside">
                <span data-testid="review-item-prov">
                  <Chip tone={demo ? 'violet' : 'ok'}>{sourceChipLabel(providerOfKind(r.kind), demo)}</Chip>
                </span>
                <span data-testid="review-item-sharing">
                  <Chip tone={shared ? 'ember' : 'neutral'}>
                    {shared && squadName ? `Shared with ${squadName}` : 'Private to me'}
                  </Chip>
                </span>
                {cal ? (
                  <span className="sq-conn__meta" data-testid="item-freebusy">Free/busy only, titles never shared.</span>
                ) : s.squadId ? (
                  <Button size="sm" variant="ghost" data-testid="review-item-share" onClick={() => void share({ sourceIds: [r.id], shared: !shared })?.then(load)}>
                    {shared ? 'Make private' : 'Share with squad'}
                  </Button>
                ) : null}
                {s.squadId ? (
                  <Button size="sm" variant="secondary" data-testid="ask-cubbie" onClick={() => askCubbie(s.squadId!, r, navigate)}>
                    Ask Squad
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
