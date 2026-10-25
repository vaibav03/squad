import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PHASE_LABEL, phaseOf, type ConnPhase } from '../../lib/connection-phase';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { LinkButton } from '../../primitives/LinkButton';
import { Notice } from '../../primitives/Notice';
import { Skeleton } from '../../primitives/Skeleton';
import { TextField } from '../../primitives/TextField';
import { HealthSummary } from '../health/HealthSummary';
import type { HealthState } from '../health/useHealth';
import type { Connection, HubClient } from './api';
import { ItemList } from './ItemList';
import {
  bridgeRequest,
  canvasAuthorize,
  canvasStatus,
  extensionPresent,
  MSG,
  onExtensionReady,
  type BridgeResult,
  type BridgeStatus,
} from './bridge';
import {
  errorCopy,
  FIXTURE_LABEL,
  kindCounts,
  oauthReturn,
  relTime,
  scopeWords,
  squadLabel,
  PHASE_TONE,
} from './model';
import { markReviewed } from './next-step';
import type { ConnectionsState } from './useConnections';
import './connections.css';

export interface ViewProps extends Omit<ConnectionsState, 'reload'> {
  /** Reloads the list (Try again). */
  reload?: () => Promise<void>;
  /** The health check, shown as the summary card at the top. Omitted in tests of the cards alone. */
  health?: HealthState;
  /** True when Google sign-in is not set up here, so the demo workspace is the way in. */
  googleDemoOnly?: boolean;
  userId: string | null;
  now: number;
  search?: string;
  /** Navigates the browser (injected so tests can observe it). */
  navigate?: (url: string) => void;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

export function ConnectionsView(p: ViewProps) {
  const routerNav = useNavigate();
  const go = p.navigate ?? ((u: string) => routerNav(u));
  const ret = oauthReturn(p.search ?? '');
  const canvas = p.connections.filter((c) => c.provider === 'canvas');
  const google = p.connections.filter((c) => c.provider === 'google');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleReview = (id: string, force?: boolean) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (force ?? !n.has(id)) {
        n.add(id);
        markReviewed();
      } else n.delete(id);
      return n;
    });
  const view = { ...p, navigate: go };
  const expired = p.error === 'http_401';
  const denied = p.error === 'http_403';
  return (
    <div className="sq-conn">
      {p.health ? <HealthSummary health={p.health} /> : null}
      {ret ? (
        <Notice
          tone={ret.ok ? 'ok' : 'error'}
          title={ret.ok ? 'Google connected' : 'Google did not connect'}
          action={
            ret.ok ? undefined : (
              <Button size="sm" variant="secondary" onClick={() => void startGoogle(view)}>
                Try connecting Google again
              </Button>
            )
          }
        >
          {ret.ok
            ? 'Your first import is running.'
            : ret.message === 'access_denied'
              ? 'You chose not to give Squad access, so nothing was imported. You can try again whenever you like.'
              : ret.message
                ? errorCopy(ret.message)
                : errorCopy('')}
        </Notice>
      ) : null}
      {expired ? (
        <Notice
          tone="warn"
          title="Your sign-in expired"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => go(`/welcome?next=${encodeURIComponent('/squad/connections')}`)}
            >
              Sign in again
            </Button>
          }
        >
          Sign in again to see and change your connections. Nothing you imported was lost.
        </Notice>
      ) : null}
      {denied ? (
        <Notice
          tone="warn"
          title="You do not have permission to do that"
          action={
            <LinkButton to="/squad" variant="secondary" size="sm">
              Back to Home
            </LinkButton>
          }
        >
          Connections belong to the person who set them up. Ask them, or connect your own Canvas or
          Google below.
        </Notice>
      ) : null}
      {p.error && !expired && !denied ? (
        <Notice tone="error" onDismiss={p.clearError}>
          {errorCopy(p.error)}
        </Notice>
      ) : null}
      {p.view === 'demo' ? (
        <Notice
          tone="info"
          title="Demo mode"
          action={
            <LinkButton to="/welcome" variant="secondary" size="sm">
              Sign in
            </LinkButton>
          }
        >
          Connections need a signed-in Squad account. Nothing is connected here.
        </Notice>
      ) : null}
      {p.view === 'offline' ? (
        <Notice
          tone="warn"
          title="Cannot reach Squad"
          action={
            <Button size="sm" variant="secondary" onClick={() => void p.reload?.()}>
              Try again
            </Button>
          }
        >
          Your connections are unchanged. Check your internet connection, then try again.
        </Notice>
      ) : null}
      {p.view === 'loading' ? (
        <div role="status" className="sq-conn__loading" data-testid="connections-loading">
          <p>Loading your connections</p>
          <Skeleton shape="block" height={96} />
          <Skeleton shape="block" height={96} />
        </div>
      ) : null}
      {p.view === 'ready' || p.view === 'demo' ? (
        <>
          <ImportedSection
            p={view}
            open={open}
            onReview={(id) => {
              toggleReview(id, true);
              setTimeout(() => scrollToId(`conn-${id}`), 0);
            }}
          />
          <CanvasSection p={view} items={canvas} open={open} toggleReview={toggleReview} />
          <GoogleSection p={view} items={google} open={open} toggleReview={toggleReview} />
        </>
      ) : null}
    </div>
  );
}

interface SectionProps {
  p: ViewProps;
  items: Connection[];
  open: Set<string>;
  toggleReview: (id: string, force?: boolean) => void;
}

/** What Cubbie can read right now, per connection, with the way to look at it. */
function ImportedSection({
  p,
  open: _open,
  onReview,
}: {
  p: ViewProps;
  open: Set<string>;
  onReview: (id: string) => void;
}) {
  const live = p.connections.filter((c) => c.state !== 'revoked');
  return (
    <section id="imported" aria-labelledby="sq-conn-imported" className="sq-conn__section">
      <h2 id="sq-conn-imported" className="sq-conn__h">
        What was imported
      </h2>
      {live.length === 0 ? (
        <Card className="sq-conn__card" data-testid="imported-empty">
          <p>
            Nothing is connected yet, so Cubbie has nothing of yours to read. Connect Canvas or
            Google and your courses and calendar appear here.
          </p>
          <div className="sq-conn__actions">
            <Button size="sm" variant="secondary" onClick={() => scrollToId('canvas')}>
              Connect Canvas
            </Button>
            <Button size="sm" variant="secondary" onClick={() => scrollToId('google')}>
              Connect Google
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="sq-conn__card">
          <ul className="sq-conn__sources" aria-label="Imported so far">
            {live.map((c) => {
              const counts = kindCounts(c.sources.byKind);
              const phase = phaseOf(c);
              return (
                <li key={c.id} className="sq-conn__row" data-testid="imported-summary">
                  <strong>{c.provider === 'canvas' ? 'Canvas' : 'Google'}</strong>
                  <Chip tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Chip>
                  <span>{counts.length ? counts.join(', ') : 'Nothing imported yet'}</span>
                  <Button size="sm" variant="secondary" onClick={() => onReview(c.id)}>
                    Review imported context
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="sq-conn__meta">
            Only you see imported items until you share them with a squad.
          </p>
        </Card>
      )}
      <p className="sq-conn__meta">
        Have a PDF instead?{' '}
        <LinkButton to="/squad/courses" variant="ghost" size="sm">
          Add a PDF in Courses
        </LinkButton>
      </p>
    </section>
  );
}

function CanvasSection({ p, items, open, toggleReview }: SectionProps) {
  const [change, setChange] = useState(false);
  const hasLive = items.some((c) => c.state !== 'revoked');
  return (
    <section id="canvas" aria-labelledby="sq-conn-canvas" className="sq-conn__section">
      <h2 id="sq-conn-canvas" className="sq-conn__h">
        Canvas
      </h2>
      {items.map((c) => (
        <ConnectionCard
          key={c.id}
          c={c}
          p={p}
          reviewOpen={open.has(c.id)}
          toggleReview={() => toggleReview(c.id)}
          changeOpen={change}
          toggleChange={() => setChange((v) => !v)}
        />
      ))}
      {!hasLive ? (
        <p className="sq-conn__state" data-testid="canvas-not-connected">
          <Chip tone="neutral">{PHASE_LABEL.not_connected}</Chip> No Canvas account is connected.
        </p>
      ) : null}
      {!hasLive || change ? <CanvasConnect p={p} /> : null}
    </section>
  );
}

function GoogleSection({ p, items, open, toggleReview }: SectionProps) {
  const [change, setChange] = useState(false);
  const hasLive = items.some((c) => c.state !== 'revoked');
  return (
    <section id="google" aria-labelledby="sq-conn-google" className="sq-conn__section">
      <h2 id="sq-conn-google" className="sq-conn__h">
        Google Workspace
      </h2>
      {items.map((c) => (
        <ConnectionCard
          key={c.id}
          c={c}
          p={p}
          reviewOpen={open.has(c.id)}
          toggleReview={() => toggleReview(c.id)}
          changeOpen={change}
          toggleChange={() => setChange((v) => !v)}
        />
      ))}
      {!hasLive ? (
        <p className="sq-conn__state" data-testid="google-not-connected">
          <Chip tone="neutral">{PHASE_LABEL.not_connected}</Chip> No Google account is connected.
        </p>
      ) : null}
      {!hasLive || change ? <GoogleConnect p={p} /> : null}
    </section>
  );
}

function ConnectionCard({
  c,
  p,
  reviewOpen,
  toggleReview,
  changeOpen,
  toggleChange,
}: {
  c: Connection;
  p: ViewProps;
  reviewOpen: boolean;
  toggleReview: () => void;
  changeOpen: boolean;
  toggleChange: () => void;
}) {
  const phase: ConnPhase = phaseOf(c);
  const [confirm, setConfirm] = useState(false);
  const [purged, setPurged] = useState<{ sources: number; chunks: number } | null>(null);
  const live = c.state !== 'revoked';
  const counts = kindCounts(c.sources.byKind);
  const reconnect = () => {
    if (c.provider === 'google') void startGoogle(p);
    else {
      if (!changeOpen) toggleChange();
      setTimeout(() => scrollToId('sq-conn-canvas-connect'), 0);
    }
  };
  const sharing = (patch: { sourceIds?: string[]; all?: boolean; shared: boolean }) =>
    p.squadId ? p.run((h) => h.share(c.id, { squadId: p.squadId!, ...patch })) : undefined;
  return (
    <Card
      as="article"
      id={`conn-${c.id}`}
      className="sq-conn__card"
      aria-label={`${c.provider} connection`}
    >
      <div className="sq-conn__row">
        <strong>{c.provider === 'canvas' ? 'Canvas' : 'Google'}</strong>
        <Chip tone={PHASE_TONE[phase]}>
          <span data-testid="conn-phase">{PHASE_LABEL[phase]}</span>
        </Chip>
      </div>
      {c.mode === 'fixture' ? (
        <p className="sq-conn__meta" data-testid="conn-demo-note">
          {FIXTURE_LABEL}
        </p>
      ) : null}
      <p className="sq-conn__state">{c.stateLabel}</p>
      {c.state === 'rate_limited' && c.retryAfter ? (
        <p className="sq-conn__meta">Will retry {relTime(c.retryAfter, p.now)}.</p>
      ) : null}
      {c.note && c.note !== c.stateLabel ? <p className="sq-conn__meta">{c.note}</p> : null}
      <dl className="sq-conn__facts">
        <dt>Account</dt>
        <dd data-testid="conn-account">
          {c.mode === 'fixture'
            ? 'None: demo data, not your account'
            : c.account
              ? [c.account.name, c.account.label, c.account.host].filter(Boolean).join(' · ')
              : 'Not reported by this connection'}
        </dd>
        <dt>Last sync</dt>
        <dd>
          {relTime(c.lastSyncAt, p.now)}
          {c.lastOutcome ? ` (${c.lastOutcome})` : ''}
        </dd>
        {c.cursor ? (
          <>
            <dt>Synced up to</dt>
            <dd>
              {c.cursor.updatedAt
                ? new Date(c.cursor.updatedAt).toISOString().slice(0, 10)
                : 'not yet'}
            </dd>
          </>
        ) : null}
        <dt>Imported</dt>
        <dd>{counts.length ? counts.join(', ') : 'nothing'}</dd>
        <dt>Shared with</dt>
        <dd>
          {c.sharedWithSquads.length
            ? c.sharedWithSquads.map((id) => squadLabel(id, p.squadNames)).join(', ')
            : 'nobody (private to you)'}
        </dd>
        <dt>Granted access</dt>
        <dd>
          <ul className="sq-conn__scopes">
            {c.grantedScopes.map((s) => (
              <li key={s}>{scopeWords(s)}</li>
            ))}
          </ul>
        </dd>
      </dl>
      {live ? (
        <div className="sq-conn__actions">
          <Button
            size="sm"
            variant="secondary"
            iconStart="refresh"
            disabled={!c.canSync || c.syncPhase === 'syncing'}
            onClick={() => void p.run((h) => h.sync(c.id))}
          >
            Sync now
          </Button>
          {c.syncVia === 'extension' ? (
            <p className="sq-conn__hint">
              This Canvas connection syncs from the browser extension. Open Canvas in that browser
              and choose Connect this account under Change source to sync again.
            </p>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={reviewOpen}
            data-testid="review-imported"
            onClick={toggleReview}
          >
            {reviewOpen ? 'Hide imported context' : 'Review imported context'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={changeOpen}
            data-testid="change-source"
            onClick={toggleChange}
          >
            {changeOpen ? 'Close source options' : 'Change source'}
          </Button>
          {c.needsReconnect || c.state === 'error' ? (
            <Button size="sm" variant="secondary" onClick={reconnect}>
              Reconnect
            </Button>
          ) : null}
          {p.squadId ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                iconStart="users"
                onClick={() => void sharing({ all: true, shared: true })}
              >
                Share all non-calendar with my squad
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void sharing({ all: true, shared: false })}
              >
                Stop sharing
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="danger" iconStart="trash" onClick={() => setConfirm(true)}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="sq-conn__actions">
          <Button size="sm" variant="secondary" onClick={reconnect}>
            Reconnect
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void p.run((h) => h.disconnect(c.id, true))}
          >
            Remove from list
          </Button>
        </div>
      )}
      {live && reviewOpen && p.client?.sources ? (
        <ItemList
          connectionId={c.id}
          syncKey={`${c.lastSyncAt}:${c.sources.total}`}
          now={p.now}
          squadId={p.squadId}
          squadNames={p.squadNames}
          load={(id) => p.client!.sources(id)}
          share={(r, shared) => sharing({ sourceIds: [r.id], shared })}
          navigate={p.navigate}
        />
      ) : null}
      {confirm ? (
        <Notice
          tone="warn"
          title="Disconnect and delete imported data?"
          action={
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const r = await p.run((h) => h.disconnect(c.id));
                  if (r) setPurged(r);
                  setConfirm(false);
                }}
              >
                Delete {c.sources.total} imported item{c.sources.total === 1 ? '' : 's'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Keep
              </Button>
            </>
          }
        >
          Squad will ask {c.provider === 'canvas' ? 'Canvas' : 'Google'} to drop access and delete
          every imported source, text excerpt and sharing choice. This cannot be undone.
        </Notice>
      ) : null}
      {purged ? (
        <Notice tone="ok">
          Deleted {purged.sources} source{purged.sources === 1 ? '' : 's'} and {purged.chunks} text
          excerpt{purged.chunks === 1 ? '' : 's'}.
        </Notice>
      ) : null}
    </Card>
  );
}

function CanvasConnect({ p }: { p: ViewProps }) {
  const [present, setPresent] = useState(extensionPresent());
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(null);
  const [feed, setFeed] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => onExtensionReady(() => setPresent(true)), []);
  useEffect(() => {
    if (present) void canvasStatus().then(setStatus);
  }, [present]);
  const checkAgain = async () => {
    setChecking(true);
    setStatus(null);
    const here = extensionPresent();
    setPresent(here);
    if (here) setStatus(await canvasStatus());
    setChecking(false);
  };
  const authorize = async (a: BridgeStatus['accounts'][number]) => {
    setResult(null);
    const r = await canvasAuthorize(a, p.userId ?? '');
    setResult(r ?? { ok: false, error: 'canvas_registration_failed' });
    if (r?.ok && p.client) void p.run((h) => h.list());
  };
  return (
    <Card className="sq-conn__card" id="sq-conn-canvas-connect">
      <div className="sq-conn__row">
        <h3 className="sq-conn__h3">Connect with the Squad browser extension</h3>
        <Chip tone={present ? 'ok' : 'ember'}>
          <span data-testid="extension-state">
            {present ? 'Detected' : 'Not detected: install the extension'}
          </span>
        </Chip>
      </div>
      <p className="sq-conn__meta">
        Recommended: uses your signed-in Canvas session, nothing is stored on our side except what
        you choose to import. No Canvas password or API token is given to Squad.
      </p>
      {!present ? (
        <Notice
          tone="info"
          title="The extension is not installed in this browser"
          action={
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={checking}
                onClick={() => void checkAgain()}
              >
                Check again
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!p.client}
                data-testid="canvas-demo"
                onClick={() => void p.run((h) => h.connectDemo('canvas'))}
              >
                Use Canvas demo workspace
              </Button>
            </>
          }
        >
          Install the extension, then press Check again. Or try Cubbie with the Canvas demo
          workspace: it fills in example items and is always labelled Demo data, never your account.
        </Notice>
      ) : status === null ? (
        <p role="status">Asking the extension</p>
      ) : status.accounts.length === 0 ? (
        <Notice
          tone="info"
          title="No Canvas sign-in detected"
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={checking}
              onClick={() => void checkAgain()}
            >
              Check again
            </Button>
          }
        >
          Sign in to your school Canvas in this browser and open any Canvas page once.
        </Notice>
      ) : (
        <ul className="sq-conn__sources" aria-label="Detected Canvas accounts">
          {status.accounts.map((a) => (
            <li key={`${a.origin}#${a.canvasUserId}`} className="sq-conn__row">
              <span>
                {a.name ? `${a.name} on ` : ''}
                {a.origin}
              </span>
              <Button size="sm" variant="secondary" onClick={() => void authorize(a)}>
                Connect this account
              </Button>
            </li>
          ))}
        </ul>
      )}
      {result ? (
        result.ok ? (
          <Notice tone="ok">Authorized. The extension is syncing your Canvas now.</Notice>
        ) : (
          <Notice tone="error">{errorCopy(result.error ?? '')}</Notice>
        )
      ) : null}
      <details className="sq-conn__fallback">
        <summary>Install steps, for whoever runs this</summary>
        <ol className="sq-conn__steps">
          <li>
            Build it: <code>pnpm --filter @squad/extension build</code>.
          </li>
          <li>
            In Chrome open <code>chrome://extensions</code>, turn on Developer mode, choose Load
            unpacked and pick <code>apps/extension/dist</code>.
          </li>
          <li>Sign in to your school Canvas in the same browser and open any Canvas page once.</li>
          <li>Come back here and press Check again, then Connect this account.</li>
        </ol>
        <p className="sq-conn__meta">
          <a href="https://github.com/vaibav03/squad/blob/main/apps/extension/README.md">
            Full install instructions
          </a>
        </p>
      </details>
      <div className="sq-conn__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={!p.client}
          onClick={() => void p.client?.pair().then(setPair, () => setPair(null))}
        >
          Create a pairing code for the extension
        </Button>
      </div>
      {pair ? (
        <Notice tone="info" title="One-time pairing code">
          <code className="sq-conn__code">{pair.code}</code> Paste it in the extension options. It
          expires {relTime(pair.expiresAt, p.now)} and works once.
        </Notice>
      ) : null}
      <h3 className="sq-conn__h3">Or paste your Canvas calendar feed (.ics) URL</h3>
      <TextField
        label="Canvas calendar feed URL"
        hint="Only due dates and events. Treat this URL like a password; Squad stores it encrypted."
        value={feed}
        onChange={setFeed}
        type="password"
        autoComplete="off"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!p.client || !feed.trim()}
        onClick={() => void p.run((h) => h.connectFeed(feed.trim())).then(() => setFeed(''))}
      >
        Connect feed
      </Button>
      <details className="sq-conn__fallback">
        <summary>Advanced (optional)</summary>
        <p className="sq-conn__meta">
          A Canvas student API token is optional and never needed for the options above. Some
          schools do not allow students to create tokens.
        </p>
        <TextField
          label="Canvas address (optional)"
          value={tokenUrl}
          onChange={setTokenUrl}
          autoComplete="off"
        />
        <TextField
          label="Student API token (optional)"
          value={token}
          onChange={setToken}
          type="password"
          autoComplete="off"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!p.client || !token.trim() || !tokenUrl.trim()}
          onClick={() =>
            void p
              .run((h) => h.connectToken(tokenUrl.trim(), token.trim()))
              .then(() => setToken(''))
          }
        >
          Connect with token
        </Button>
      </details>
    </Card>
  );
}

async function startGoogle(p: ViewProps) {
  const r = await p.run((h) => h.googleAuthorize('/squad/connections'));
  if (r) (p.navigate ?? ((u: string) => window.location.assign(u)))(r.authorization_url);
}

function GoogleConnect({ p }: { p: ViewProps }) {
  return (
    <Card className="sq-conn__card" id="sq-conn-google-connect">
      <h3 className="sq-conn__h3">Connect Google</h3>
      <p className="sq-conn__meta">
        Squad asks Google for these read-only permissions and nothing else:
      </p>
      <ul className="sq-conn__scopes">
        <li>
          <strong>Calendar (read only):</strong> your events. Your squad sees only busy times unless
          you share an event.
        </li>
        <li>
          <strong>Drive (files you pick):</strong> only files you choose. Nothing else in Drive.
        </li>
        <li>
          <strong>Classroom (your coursework):</strong> your own coursework, no grades.
        </li>
      </ul>
      <p className="sq-conn__meta">
        No Gmail, no editing, no deleting. You can disconnect at any time, which deletes what was
        imported.
      </p>
      {p.googleDemoOnly ? (
        <p className="sq-conn__meta" data-testid="google-not-set-up">
          Not set up yet: add the Google sign-in details to connect your own account. Until then,
          the demo workspace shows how Cubbie uses Google.
        </p>
      ) : null}
      <div className="sq-conn__actions">
        {p.googleDemoOnly ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!p.client}
            data-testid="google-demo"
            onClick={() => void p.run((h) => h.connectDemo('google'))}
          >
            Use Google demo workspace
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!p.client}
            onClick={() => void startGoogle(p)}
          >
            Continue to Google
          </Button>
        )}
      </div>
      {p.googleDemoOnly ? (
        <p className="sq-conn__meta">Demo data: example items, not your account.</p>
      ) : null}
    </Card>
  );
}

export { MSG, bridgeRequest };
export type { HubClient };
