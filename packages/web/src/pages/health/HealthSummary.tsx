import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { Skeleton } from '../../primitives/Skeleton';
import { relTime } from '../connections/model';
import { runFixApi } from './api';
import {
  countByStatus,
  customerGroups,
  groupChecks,
  GROUP_TITLE,
  headline,
  STATUS_TONE,
  STATUS_WORD,
} from './model';
import type { HealthState } from './useHealth';
import './health.css';

/** A hash target stays on this page; anything else is a normal route. */
function FixLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="sq-btn sq-btn--secondary sq-btn--sm" data-testid="health-group-fix">
      <span className="sq-btn__label">{children}</span>
    </Link>
  );
}

/** Top of Connections: "Everything works" or "N things need attention", plain wording, then collapsed technical details. */
export function HealthSummary({ health: h }: { health: HealthState }) {
  const r = h.report;
  const [busy, setBusy] = useState(false);
  const rerun = async () => {
    setBusy(true);
    await h.rerun();
    setBusy(false);
  };
  if (h.state === 'demo') return null;
  return (
    <section
      id="health"
      className="sq-health"
      aria-label="Connection check"
      data-testid="health-page"
    >
      {h.state === 'loading' ? (
        <Card className="sq-health__card" data-testid="health-loading">
          <div role="status">Checking your connections</div>
          <Skeleton shape="line" width="40%" />
          <Skeleton shape="block" height={64} />
        </Card>
      ) : null}
      {h.state === 'unreachable' ? (
        <Notice
          tone="error"
          title="The connection check did not answer"
          action={
            <Button size="sm" variant="secondary" onClick={() => void rerun()}>
              Try again
            </Button>
          }
        >
          Squad could not check your connections just now, so we cannot say they work. Your imported
          items are unchanged.
        </Notice>
      ) : null}
      {r ? <Summary h={h} busy={busy} rerun={rerun} /> : null}
    </section>
  );
}

function Summary({
  h,
  busy,
  rerun,
}: {
  h: HealthState;
  busy: boolean;
  rerun: () => Promise<void>;
}) {
  const r = h.report!;
  const groups = customerGroups(r);
  const head = headline(groups);
  return (
    <>
      <Card className="sq-health__card">
        <div className="sq-health__summary">
          <h2 className="sq-health__h" data-testid="health-headline">
            {head.text}
          </h2>
          <Chip tone={head.n === 0 ? 'ok' : 'ember'}>
            {head.n === 0 ? 'All good' : 'Needs a look'}
          </Chip>
          <Button
            size="sm"
            variant="ghost"
            iconStart="refresh"
            disabled={busy}
            onClick={() => void rerun()}
          >
            {busy ? 'Checking' : 'Run the check again'}
          </Button>
        </div>
        <ul className="sq-health__groups" aria-label="What works">
          {groups.map((g) => (
            <li
              key={g.id}
              className="sq-health__group"
              data-testid={`health-group-${g.id}`}
              data-attention={g.needsAttention}
            >
              <div className="sq-health__row">
                <strong>{g.title}</strong>
                <Chip tone={g.tone}>{g.label}</Chip>
              </div>
              <p className="sq-health__reason">{g.sentence}</p>
              {g.fixLabel ? <FixLink to={g.fixTo}>{g.fixLabel}</FixLink> : null}
            </li>
          ))}
        </ul>
      </Card>
      <HealthDetails h={h} busy={busy} rerun={rerun} />
    </>
  );
}

/** Technical detail: check ids, setting names, the address sign-in returns to. Collapsed by default. */
function HealthDetails({
  h,
  busy,
  rerun,
}: {
  h: HealthState;
  busy: boolean;
  rerun: () => Promise<void>;
}) {
  const nav = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const r = h.report!;
  const counts = countByStatus(r);
  return (
    <details className="sq-health__details" data-testid="health-details">
      <summary>Details for whoever runs this</summary>
      {note ? (
        <Notice tone="info" onDismiss={() => setNote(null)}>
          {note}
        </Notice>
      ) : null}
      <div className="sq-health__summary">
        <Chip tone={STATUS_TONE[r.overall]}>
          <span data-testid="health-overall">{`Overall: ${STATUS_WORD[r.overall]}`}</span>
        </Chip>
        <span className="sq-health__meta">
          {counts.pass} pass, {counts.warn} warn, {counts.fail} fail, {counts.blocked} blocked
        </span>
        <span className="sq-health__meta">
          Checked {relTime(r.generatedAt, Date.now())}
          {r.servedOrigin ? ` against ${r.servedOrigin}` : ''}
        </span>
        <Button
          size="sm"
          variant="secondary"
          iconStart="refresh"
          disabled={busy}
          onClick={() => void rerun()}
        >
          {busy ? 'Probing' : 'Re-run'}
        </Button>
      </div>
      {groupChecks(r).map(({ group, checks }) => (
        <section key={group} className="sq-health__tgroup" aria-label={GROUP_TITLE[group]}>
          <h3 className="sq-health__h3">{GROUP_TITLE[group]}</h3>
          <ol className="sq-health__chain">
            {checks.map((c) => (
              <li key={c.id} data-testid={`health-check-${c.id}`} data-status={c.status}>
                <Card className={`sq-health__check sq-health__check--${c.status}`}>
                  <div className="sq-health__row">
                    <strong>{c.label}</strong>
                    <code>{c.id}</code>
                    <Chip tone={STATUS_TONE[c.status]}>
                      <span data-testid={`health-status-${c.id}`}>{STATUS_WORD[c.status]}</span>
                    </Chip>
                    {c.mode ? (
                      <Chip tone={c.mode === 'fixture' ? 'violet' : 'neutral'}>
                        {c.mode === 'fixture' ? 'Demo data (not your account)' : c.mode}
                      </Chip>
                    ) : null}
                  </div>
                  <p className="sq-health__reason">{c.reason}</p>
                  {c.missingEnv?.length ? (
                    <p className="sq-health__meta">
                      Missing env: <code>{c.missingEnv.join(', ')}</code>
                    </p>
                  ) : null}
                  {c.facts ? (
                    <dl className="sq-health__facts">
                      {Object.entries(c.facts).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <div className="sq-health__row">
                    {c.fix ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`health-fix-${c.id}`}
                        onClick={async () => {
                          if (c.fix?.to) nav(c.fix.to);
                          else if (c.fix?.api && h.hub) {
                            const ok = await runFixApi(h.hub, c.fix.api);
                            setNote(
                              ok
                                ? `${c.fix.label}: done. Checking again.`
                                : `${c.fix.label}: Squad refused it.`,
                            );
                            await rerun();
                          }
                        }}
                      >
                        {c.fix.label}
                      </Button>
                    ) : null}
                    <span className="sq-health__meta">
                      checked {relTime(c.probedAt, Date.now())}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </details>
  );
}
