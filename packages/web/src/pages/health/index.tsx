import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { useShell } from '../../shell/shell-context';
import { relTime } from '../connections/model';
import { runFixApi } from './api';
import { countByStatus, groupChecks, GROUP_TITLE, STATUS_TONE, STATUS_WORD } from './model';
import { useHealth } from './useHealth';
import './health.css';

/** /squad/connections/health: every link of the chain, each backed by a real probe on the hub. */
export default function HealthRoute() {
  const { setTitle } = useShell();
  const nav = useNavigate();
  const h = useHealth();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setTitle('Integration health'), [setTitle]);
  const rerun = async () => {
    setBusy(true);
    await h.rerun();
    setBusy(false);
  };
  const r = h.report;
  const counts = r ? countByStatus(r) : null;
  return (
    <Page title="Integration health">
      <div className="sq-health" data-testid="health-page">
        <p className="sq-health__lede">
          Each line is a live probe of the real system, run when you open this page. Nothing here is a
          static badge. <Link to="/squad/connections">Back to Connections</Link>
        </p>
        {h.state === 'demo' ? (
          <Notice tone="info" title="Demo mode">
            Health needs a live Squad hub and a signed-in account. Nothing was probed.
          </Notice>
        ) : null}
        {h.state === 'loading' ? <p role="status">Running probes</p> : null}
        {h.state === 'unreachable' ? (
          <Notice
            tone="error"
            title="Health check did not answer"
            action={
              <Button size="sm" variant="secondary" onClick={() => void rerun()}>
                Re-run
              </Button>
            }
          >
            The hub could not run its probes ({h.error}). The chain state is unknown.
          </Notice>
        ) : null}
        {note ? <Notice tone="info" onDismiss={() => setNote(null)}>{note}</Notice> : null}
        {r && counts ? (
          <>
            <div className="sq-health__summary">
              <Chip tone={STATUS_TONE[r.overall]}>
                <span data-testid="health-overall">{`Overall: ${STATUS_WORD[r.overall]}`}</span>
              </Chip>
              <span className="sq-health__meta">
                {counts.pass} pass, {counts.warn} warn, {counts.fail} fail, {counts.blocked} blocked
              </span>
              <span className="sq-health__meta">
                Probed {relTime(r.generatedAt, Date.now())}
                {r.servedOrigin ? ` against ${r.servedOrigin}` : ''}
              </span>
              <Button size="sm" variant="secondary" iconStart="refresh" disabled={busy} onClick={() => void rerun()}>
                {busy ? 'Probing' : 'Re-run'}
              </Button>
            </div>
            {groupChecks(r).map(({ group, checks }) => (
              <section key={group} className="sq-health__group" aria-label={GROUP_TITLE[group]}>
                <h2 className="sq-health__h">{GROUP_TITLE[group]}</h2>
                <ol className="sq-health__chain">
                  {checks.map((c) => (
                    <li key={c.id} data-testid={`health-check-${c.id}`} data-status={c.status}>
                      <Card className={`sq-health__check sq-health__check--${c.status}`}>
                        <div className="sq-health__row">
                          <strong>{c.label}</strong>
                          <Chip tone={STATUS_TONE[c.status]}>
                            <span data-testid={`health-status-${c.id}`}>{STATUS_WORD[c.status]}</span>
                          </Chip>
                          {c.mode ? (
                            <Chip tone={c.mode === 'fixture' ? 'violet' : 'neutral'}>
                              {c.mode === 'fixture' ? 'Fixture (simulated, not your account)' : c.mode}
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
                              variant={c.status === 'pass' ? 'ghost' : 'primary'}
                              data-testid={`health-fix-${c.id}`}
                              onClick={async () => {
                                if (c.fix?.to) nav(c.fix.to);
                                else if (c.fix?.api && h.hub) {
                                  const ok = await runFixApi(h.hub, c.fix.api);
                                  setNote(ok ? `${c.fix.label}: done. Re-running probes.` : `${c.fix.label}: the hub refused it.`);
                                  await rerun();
                                }
                              }}
                            >
                              {c.fix.label}
                            </Button>
                          ) : null}
                          <span className="sq-health__meta">probed {relTime(c.probedAt, Date.now())}</span>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </Page>
  );
}
