import { useId, useState, type ReactNode } from 'react';
import { ConnectionBadge, LvIcon, StateBlock } from '../../overlays/kit';
import { Button, Icon, Page, Skeleton, TextField } from '../../primitives';
import { WEB_BUILD, formatBuiltAt, isStaleBuild } from '../../lib/build';
import {
  countLabel,
  explainDemo,
  formatDuration,
  money,
  REASON_TITLE,
  relTime,
  seriesLast,
  seriesTotal,
  sparkPoints,
  type AdminStatus,
  type StatusView as View,
} from './model';
import './status.css';

export interface StatusPageProps {
  view: View;
  data?: AdminStatus;
  now: number;
  sample: boolean;
  fetchedAt?: number;
  token: string;
  setToken: (t: string) => void;
  refresh: () => void;
}

function Panel({
  title,
  children,
  className,
  tone,
  note,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  tone?: 'ok' | 'warn' | 'bad';
  note?: string;
}) {
  const id = useId();
  return (
    <section
      className={['st-panel', className].filter(Boolean).join(' ')}
      data-tone={tone}
      aria-labelledby={id}
    >
      <header className="st-panel__head">
        <h2 id={id} className="st-label">
          {title}
        </h2>
        {note ? <span className="st-note">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Dot({ tone, label }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; label: string }) {
  return (
    <span className="st-pill" data-tone={tone}>
      <Icon
        name={tone === 'ok' ? 'ok' : tone === 'warn' ? 'alert' : tone === 'bad' ? 'error' : 'moon'}
        size={12}
      />
      {label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="st-stat">
      <dt className="st-stat__label">{label}</dt>
      <dd className="st-stat__value">{value}</dd>
      {hint ? <dd className="st-stat__hint">{hint}</dd> : null}
    </div>
  );
}

const W = 168;
const H = 44;
function Spark({
  title,
  values,
  total,
  unit,
  tone = 'accent',
}: {
  title: string;
  values: number[];
  /** headline number: total over the hour, or the latest value for gauges */
  total: string;
  unit: string;
  tone?: 'accent' | 'bad' | 'warn';
}) {
  const pts = sparkPoints(values, W, H);
  const max = Math.max(0, ...values);
  const label = `${title}: ${total} ${unit}, peak ${max} per minute, last 60 minutes`;
  return (
    <figure className="st-spark" data-tone={tone}>
      <figcaption className="st-spark__cap">
        <span className="st-spark__title">{title}</span>
        <span className="st-spark__num">{total}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="st-spark__svg">
        <line x1="0" x2={W} y1={H - 1} y2={H - 1} className="st-spark__base" />
        {pts ? <polyline points={pts} className="st-spark__line" fill="none" /> : null}
      </svg>
      <span className="st-spark__unit">{unit}</span>
    </figure>
  );
}

function Fix({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="st-fix">
      <p className="st-fix__label">The fix</p>
      <p className="st-fix__text">{text}</p>
      <Button
        size="sm"
        variant="secondary"
        iconStart={copied ? 'check' : 'link'}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            },
            () => {},
          );
        }}
      >
        {copied ? 'Copied' : 'Copy fix'}
      </Button>
    </div>
  );
}

function Ready({ s, now }: { s: AdminStatus; now: number }) {
  const demo = s.llm.mode === 'demo';
  const reason = s.llm.reason ?? 'no_key';
  const ex = explainDemo(s);
  const down = s.agents.filter((a) => !a.up).length;
  const hourEvents = seriesTotal(s.series.events);
  const hourReq = seriesTotal(s.series.http_requests);
  const hourErr = seriesTotal(s.series.http_errors);
  return (
    <div className="st-grid">
      <Panel
        title="Language model"
        className="st-llm"
        tone={demo ? 'warn' : 'ok'}
        note={demo ? undefined : 'Gemini'}
      >
        <div className="st-llm__row">
          <p className="st-big" data-testid="llm-mode">
            {demo ? 'Demo mode' : 'Real model'}
          </p>
          <Dot tone={demo ? 'warn' : 'ok'} label={demo ? 'Scripted answers' : 'Live answers'} />
        </div>
        {demo ? (
          <>
            <p className="st-reason">{REASON_TITLE[reason] ?? 'The real model is unavailable.'}</p>
            <dl className="st-stats">
              <Stat
                label="In demo mode for"
                value={s.llm.since ? formatDuration((now - s.llm.since) / 1000) : 'since boot'}
              />
              <Stat
                label="Next probe"
                value={<span data-testid="next-probe">{relTime(s.llm.nextProbeAt, now)}</span>}
                hint={
                  s.llm.nextProbeAt === undefined
                    ? 'Does not recover by itself'
                    : `Last probe ${relTime(s.llm.lastProbeAt, now)}`
                }
              />
              <Stat label="Demo time, total" value={formatDuration(s.llm.demoSeconds)} />
            </dl>
          </>
        ) : (
          <p className="st-reason">
            Answers come from Gemini. No probing needed while it stays healthy.
          </p>
        )}
        <dl className="st-stats st-stats--tight">
          <Stat
            label="Calls (ok / demo / failed)"
            value={`${s.llm.calls.ok} / ${s.llm.calls.fallback} / ${s.llm.calls.failed}`}
          />
          <Stat label="Tokens" value={s.llm.tokens.toLocaleString('en-US')} />
          <Stat label="Est. cost" value={money(s.llm.costUsd)} hint="Estimate, not billing" />
        </dl>
      </Panel>

      <Panel
        title="Credits"
        className="st-credits"
        tone={s.credits.state === 'depleted' ? 'bad' : s.credits.state === 'ok' ? 'ok' : undefined}
      >
        <Dot
          tone={s.credits.state === 'depleted' ? 'bad' : s.credits.state === 'ok' ? 'ok' : 'idle'}
          label={
            s.credits.state === 'depleted'
              ? 'Depleted'
              : s.credits.state === 'ok'
                ? 'Available'
                : 'Not checked (no live model)'
          }
        />
        {s.credits.fix ? (
          <Fix text={s.credits.fix} />
        ) : demo && s.llm.fix ? (
          <Fix text={s.llm.fix} />
        ) : (
          <p className="st-quiet">
            Nothing to fix. The hub reports here the moment credits run out.
          </p>
        )}
      </Panel>

      <Panel title="What demo mode means" className="st-explain">
        <h3 className="st-explain__h">{ex.heading}</h3>
        <ul className="st-explain__list">
          <li>
            <strong>What students see.</strong> {ex.what}
          </li>
          <li>
            <strong>Why.</strong> {ex.why}
          </li>
          <li>
            <strong>How it ends.</strong> {ex.how}
          </li>
        </ul>
      </Panel>

      <Panel
        title="Processes"
        className="st-proc"
        tone={down > 0 ? 'bad' : undefined}
        note={
          s.agents.length ? `${s.agents.length - down} of ${s.agents.length} agents up` : undefined
        }
      >
        <ul className="st-list">
          <li>
            <span>Hub</span>
            <Dot tone="ok" label="Up" />
          </li>
          <li>
            <span>Voice (text to speech)</span>
            <Dot
              tone={s.tts.state === 'on' ? 'ok' : 'idle'}
              label={s.tts.state === 'on' ? 'On' : 'Off'}
            />
          </li>
          <li>
            <span>Ports (brain, quiz, media)</span>
            <Dot
              tone={s.ports === 'real' ? 'ok' : 'idle'}
              label={s.ports === 'real' ? 'Real' : 'Stubs'}
            />
          </li>
          {s.agents.map((a) => (
            <li key={a.id}>
              <span>
                Agent <code>{a.id}</code>
              </span>
              <span className="st-right">
                {a.latencyMs !== undefined ? (
                  <span className="st-note">{a.latencyMs} ms</span>
                ) : null}
                <Dot tone={a.up ? 'ok' : 'bad'} label={a.up ? 'Up' : 'Down'} />
              </span>
            </li>
          ))}
        </ul>
        {s.agents.length === 0 ? (
          <p className="st-quiet">
            No mesh agents are configured (AGENT_PEERS is empty), so nothing to probe.
          </p>
        ) : null}
      </Panel>

      <Panel title="Live stream and events" className="st-sse">
        <dl className="st-stats">
          <Stat label="SSE subscribers" value={s.sse.subscribers} />
          <Stat
            label="Queue drops"
            value={s.sse.drops}
            hint={s.sse.drops ? 'Slow clients were cut off' : 'None'}
          />
          <Stat label="Last event #" value={s.sse.lastSeq.toLocaleString('en-US')} />
          <Stat label="Events accepted" value={s.events.accepted.toLocaleString('en-US')} />
          <Stat label="Rejected / dropped" value={`${s.events.invalid} / ${s.events.dropped}`} />
          <Stat
            label="HTTP 5xx"
            value={`${s.http.errors5xx} of ${s.http.requests.toLocaleString('en-US')}`}
          />
        </dl>
      </Panel>

      <Panel title="Last 60 minutes" className="st-trend" note="In memory, resets on restart">
        <div className="st-sparks">
          <Spark
            title="Requests"
            values={s.series.http_requests ?? []}
            total={hourReq.toLocaleString('en-US')}
            unit="per minute"
          />
          <Spark
            title="Events"
            values={s.series.events ?? []}
            total={hourEvents.toLocaleString('en-US')}
            unit="per minute"
          />
          <Spark
            title="SSE subscribers"
            values={s.series.sse_subscribers ?? []}
            total={String(seriesLast(s.series.sse_subscribers))}
            unit="now"
          />
          <Spark
            title="Server errors"
            values={s.series.http_errors ?? []}
            total={String(hourErr)}
            unit="per minute"
            tone="bad"
          />
          <Spark
            title="Stream drops"
            values={s.series.sse_drops ?? []}
            total={String(seriesTotal(s.series.sse_drops))}
            unit="per minute"
            tone="warn"
          />
          <Spark
            title="Demo mode"
            values={s.series.demo_mode ?? []}
            total={`${seriesTotal(s.series.demo_mode)} min`}
            unit="minutes on demo"
            tone="warn"
          />
        </div>
      </Panel>

      <Panel
        title="Recent errors"
        className="st-errors"
        tone={s.errors.total > 0 ? 'bad' : undefined}
        note={s.errors.sentry ? 'Also sent to Sentry' : 'Kept in memory only'}
      >
        {s.errors.recent.length === 0 ? (
          <p className="st-quiet">No errors since the hub started.</p>
        ) : (
          <ol className="st-errlist">
            {s.errors.recent.map((e) => (
              <li key={e.id}>
                <div className="st-errlist__top">
                  <strong>{e.name}</strong>
                  <span className="st-note">
                    {e.kind}
                    {e.count > 1 ? `, ${e.count} times` : ''}, {relTime(e.ts, now)}
                  </span>
                </div>
                <p className="st-errlist__msg">{e.message}</p>
                {e.corr ? (
                  <p className="st-note">
                    Trace id <code>{e.corr}</code>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Skills" className="st-skills" note="Names and counts only">
        {s.skills.recent.length === 0 ? (
          <p className="st-quiet">No skill has run yet. They show up here as students ask.</p>
        ) : (
          <>
            <ul className="st-list">
              {s.skills.recent.slice(0, 6).map((k, i) => (
                <li key={`${k.name}-${k.at}-${i}`}>
                  <span>
                    <code>{k.name}</code>
                  </span>
                  <span className="st-right">
                    <span className="st-note">{relTime(k.at, now)}</span>
                    <Dot tone={k.ok ? 'ok' : 'bad'} label={k.ok ? 'Done' : 'Failed'} />
                  </span>
                </li>
              ))}
            </ul>
            <ul className="st-chips" aria-label="Invocation counts">
              {Object.entries(s.skills.counts).map(([n, c]) => (
                <li key={n}>
                  <code>{n}</code> <b>{c}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Activity" className="st-activity" note="Counts under 3 are hidden">
        <dl className="st-stats">
          <Stat label="Quiz answers" value={countLabel(s.activity.quizAnswers)} />
          <Stat label="Council runs" value={countLabel(s.activity.councilRuns)} />
          <Stat label="Trip votes and confirms" value={countLabel(s.activity.tripActions)} />
          <Stat label="Replay plays" value={countLabel(s.activity.replayPlays)} />
        </dl>
      </Panel>

      <Panel title="Build" className="st-build">
        <dl className="st-stats st-stats--tight">
          <Stat label="Version" value={s.version} />
          <Stat label="Commit" value={<code>{s.gitSha.slice(0, 8)}</code>} />
          <Stat label="Web build" value={<code>{WEB_BUILD.sha.slice(0, 8)}</code>} />
          <Stat label="Web built" value={formatBuiltAt(WEB_BUILD.builtAt) || 'unknown'} />
          <Stat label="Uptime" value={formatDuration(s.uptimeS)} />
          <Stat
            label="Built"
            value={new Date(s.builtAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'}
          />
        </dl>
        {isStaleBuild(WEB_BUILD.sha, s.gitSha) ? (
          <p className="st-stale" role="status" data-testid="stale-build">
            Stale build: this page is web <code>{WEB_BUILD.sha}</code> but the hub runs{' '}
            <code>{s.gitSha}</code>. Restart the web dev server, then reload.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

function Denied({ token, setToken }: { token: string; setToken: (t: string) => void }) {
  const [draft, setDraft] = useState(token);
  return (
    <div className="st-denied">
      <StateBlock
        kind="error"
        title="Operators only"
        body="This page needs admin access. Enter the admin token (HUB_ADMIN_TOKEN) or the internal secret. It is kept for this tab only."
      />
      <form
        className="st-denied__form"
        onSubmit={(e) => {
          e.preventDefault();
          setToken(draft.trim());
        }}
      >
        <TextField
          label="Admin token"
          type="password"
          value={draft}
          onChange={setDraft}
          autoComplete="off"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Unlock
        </Button>
      </form>
    </div>
  );
}

export function StatusPage(p: StatusPageProps) {
  const connection = p.sample
    ? 'replaying'
    : p.view === 'offline'
      ? 'offline'
      : p.view === 'error'
        ? 'error'
        : 'live';
  return (
    <Page
      className="st-page"
      eyebrow="Operations"
      title="Status"
      width="wide"
      actions={
        <span className="st-actions">
          <ConnectionBadge connection={connection} />
          {p.view === 'ready' && !p.sample ? (
            <Button size="sm" variant="secondary" iconStart="sparkle" onClick={p.refresh}>
              Refresh
            </Button>
          ) : null}
        </span>
      }
    >
      <p className="st-lede">
        Is Squad healthy, and if answers are scripted, why. Nothing here contains student messages
        or private values.
        {p.sample ? ' Showing sample data: connect a hub to see the real thing.' : ''}
      </p>
      {p.view === 'loading' && (
        <div className="st-skel" role="status" aria-busy="true">
          <span className="lv-vh">Loading status</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} shape="block" height={i === 0 ? 220 : 150} />
          ))}
        </div>
      )}
      {p.view === 'error' && (
        <StateBlock
          kind="error"
          title="The hub did not answer"
          body="Status could not be read. If the hub is down, start it with pnpm dev:all; see docs/ops/RUNBOOK.md, section Hub down."
          onRetry={p.refresh}
        />
      )}
      {p.view === 'offline' && (
        <StateBlock
          kind="offline"
          title="You are offline"
          body="Status refreshes by itself when your connection is back."
          onRetry={p.refresh}
          retryLabel="Check again"
        />
      )}
      {p.view === 'denied' && <Denied token={p.token} setToken={p.setToken} />}
      {p.view === 'ready' && p.data && <Ready s={p.data} now={p.now} />}
      {p.view === 'ready' && p.fetchedAt ? (
        <p className="st-foot" aria-live="off">
          Updated {relTime(p.fetchedAt, p.now)}. Refreshes every 10 seconds while this tab is open.
        </p>
      ) : null}
    </Page>
  );
}

export { LvIcon };
