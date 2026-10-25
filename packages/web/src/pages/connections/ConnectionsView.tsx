import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HealthBanner } from '../health/HealthBanner';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { TextField } from '../../primitives/TextField';
import type { Connection, HubClient, SourceRow } from './api';
import { askCubbie, pickAskItems } from './askCubbie';
import { deriveProviderState, type ProviderView } from './connection-state';
import { plural } from '../../lib/plural';
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
  countLines,
  oauthReturn,
  relTime,
  scopeWords,
  squadLabel,
  STATE_TONE,
} from './model';
import type { ConnectionsState } from './useConnections';
import './connections.css';

export interface ViewProps extends Omit<ConnectionsState, 'reload'> {
  userId: string | null;
  now: number;
  search?: string;
  /** Navigates the browser (injected so tests can observe it). */
  navigate?: (url: string) => void;
}

export function ConnectionsView(p: ViewProps) {
  const ret = oauthReturn(p.search ?? '');
  const canvas = p.connections.filter((c) => c.provider === 'canvas');
  const google = p.connections.filter((c) => c.provider === 'google');
  const gv = deriveProviderState('google', google, {
    now: p.now,
    justReturned: ret?.ok === true && (ret.provider ?? 'google') === 'google',
  });
  return (
    <div className="sq-conn">
      <p className="sq-conn__lede">
        Bring your Canvas and Google context into Squad. Everything is read-only, private to you by
        default, and shared with a squad only when you choose. Disconnecting deletes what was
        imported.
      </p>
      <HealthBanner
        reloadKey={p.connections.map((c) => `${c.id}${c.lastSyncAt}${c.state}`).join()}
      />
      <p className="sq-conn__meta">
        <Link to="/squad/connections/health" data-testid="health-link">
          Integration health
        </Link>{' '}
        shows every link from connection to chat, plan and trip.{' '}
        <Link to="/squad/connections/review" data-testid="review-link">
          Review imported context
        </Link>
      </p>
      {ret ? (
        <Notice
          tone={
            ret.ok ? (gv.state === 'reauth' || gv.state === 'degraded' ? 'warn' : 'ok') : 'error'
          }
          title={ret.ok ? `Google: ${gv.label}` : 'Google did not connect'}
        >
          <span data-testid="oauth-return-text">
            {ret.ok
              ? [gv.text, gv.firstSyncRunning ? null : gv.lastSyncText].filter(Boolean).join(' ')
              : ret.message
                ? errorCopy(ret.message)
                : errorCopy('')}
          </span>
        </Notice>
      ) : null}
      {p.error ? (
        <Notice tone="error" onDismiss={p.clearError}>
          {errorCopy(p.error)}
        </Notice>
      ) : null}
      {p.view === 'demo' ? (
        <Notice tone="info" title="Demo mode">
          Connections need a live Squad hub and a signed-in account. Nothing is connected here.
        </Notice>
      ) : null}
      {p.view === 'offline' ? (
        <Notice tone="warn" title="Cannot reach the hub">
          Your connections are unchanged. Try again in a moment.
        </Notice>
      ) : null}
      {p.view === 'loading' ? <p role="status">Loading connections</p> : null}
      {p.view === 'ready' || p.view === 'demo' ? (
        <>
          <CanvasSection
            p={p}
            items={canvas}
            v={deriveProviderState('canvas', canvas, { now: p.now })}
          />
          <GoogleSection p={p} items={google} v={gv} />
        </>
      ) : null}
    </div>
  );
}

function CanvasSection({ p, items, v }: { p: ViewProps; items: Connection[]; v: ProviderView }) {
  return (
    <section aria-labelledby="sq-conn-canvas" className="sq-conn__section">
      <h2 id="sq-conn-canvas" className="sq-conn__h">
        Canvas
      </h2>
      {items.map((c) => (
        <ConnectionCard key={c.id} c={c} p={p} />
      ))}
      {v.state === 'not_connected' && !v.sub ? (
        <p className="sq-conn__state" data-testid="canvas-not-connected">
          <Chip tone="neutral">{v.label}</Chip> {v.text}
        </p>
      ) : null}
      <CanvasConnect p={p} />
    </section>
  );
}

function GoogleSection({ p, items, v }: { p: ViewProps; items: Connection[]; v: ProviderView }) {
  return (
    <section aria-labelledby="sq-conn-google" className="sq-conn__section">
      <h2 id="sq-conn-google" className="sq-conn__h">
        Google Workspace
      </h2>
      {items.map((c) => (
        <ConnectionCard key={c.id} c={c} p={p} />
      ))}
      {v.state === 'not_connected' && !v.sub ? (
        <p className="sq-conn__state" data-testid="google-not-connected">
          <Chip tone="neutral">{v.label}</Chip> {v.text}
        </p>
      ) : null}
      {v.state === 'connecting' ? (
        <p className="sq-conn__state" data-testid="google-connecting" role="status">
          <Chip tone="ember">{v.label}</Chip> {v.text}
        </p>
      ) : null}
      {v.showConnectPanel ? <GoogleConnect p={p} /> : null}
    </section>
  );
}

function ConnectionCard({ c, p }: { c: Connection; p: ViewProps }) {
  const [confirm, setConfirm] = useState(false);
  const [purged, setPurged] = useState<{ sources: number; chunks: number } | null>(null);
  const live = c.state !== 'revoked';
  const counts = countLines(c);
  const [open, setOpen] = useState(() => isReviewed(c.id));
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const v = deriveProviderState(c.provider, [c], { now: p.now, reviewed: open });
  const load = useCallback(() => {
    if (live && p.client?.sources) void p.client.sources(c.id).then(setRows, () => setRows(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, live, p.client]);
  useEffect(load, [load, c.lastSyncAt, c.sources.total]);
  const reconnect = () => {
    if (c.provider === 'google') void startGoogle(p);
    else document.getElementById('sq-conn-canvas-connect')?.scrollIntoView?.();
  };
  const sharing = (patch: { sourceIds?: string[]; all?: boolean; shared: boolean }) =>
    p.squadId ? p.run((h) => h.share(c.id, { squadId: p.squadId!, ...patch })) : undefined;
  return (
    <Card as="article" className="sq-conn__card" aria-label={`${c.provider} connection`}>
      <div className="sq-conn__row">
        <strong>{c.provider === 'canvas' ? 'Canvas' : 'Google'}</strong>
        <span data-testid="conn-state">
          <Chip
            tone={
              v.state === 'degraded' || v.state === 'reauth'
                ? 'alert'
                : v.state === 'syncing'
                  ? 'ember'
                  : v.state === 'live'
                    ? 'ok'
                    : v.state === 'demo'
                      ? 'violet'
                      : STATE_TONE[c.state]
            }
          >
            {v.label}
          </Chip>
        </span>
        {v.fixture && v.state !== 'demo' ? <Chip tone="violet">Demo data</Chip> : null}
      </div>
      <p className="sq-conn__state" data-testid="conn-text">
        {v.text}
      </p>
      {v.fixture ? (
        <p className="sq-conn__meta" data-testid="conn-fixture-note">
          {FIXTURE_LABEL}: sample data from the repo. Nothing was read from a real{' '}
          {c.provider === 'canvas' ? 'Canvas' : 'Google'} account.
        </p>
      ) : null}
      {c.state === 'rate_limited' && c.retryAfter ? (
        <p className="sq-conn__meta">Will retry {relTime(c.retryAfter, p.now)}.</p>
      ) : null}
      {c.note && c.note !== c.stateLabel ? <p className="sq-conn__meta">{c.note}</p> : null}
      <dl className="sq-conn__facts">
        <dt>Account</dt>
        <dd data-testid="conn-account">
          {c.mode === 'fixture'
            ? 'Demo workspace (simulated)'
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
            {c.grantedScopes.map((s, i) => (
              <li key={s}>{c.grantedScopeLabels?.[i] ?? scopeWords(s)}</li>
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
              and use Connect in the Canvas card to sync again.
            </p>
          ) : null}
          {v.cta === 'reconnect' ? (
            <Button size="sm" variant="primary" data-testid="reconnect-cta" onClick={reconnect}>
              Reconnect
            </Button>
          ) : null}
          {v.cta === 'review' ? (
            <Button
              size="sm"
              variant="primary"
              iconStart="sparkle"
              data-testid="review-imported-context"
              onClick={() => {
                markReviewed(c.id);
                setOpen(true);
              }}
            >
              Review imported context
            </Button>
          ) : null}
          {v.cta === 'ask' && p.squadId && rows ? (
            <Button
              size="sm"
              variant="primary"
              iconStart="sparkle"
              data-testid="ask-cubbie-primary"
              onClick={() => askCubbie(p.squadId!, pickAskItems(rows, p.now), p.navigate)}
            >
              Ask Squad with this
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void p.run((h) => h.disconnect(c.id, true))}
          >
            Remove from list
          </Button>
        </div>
      )}
      {live && open && rows ? (
        <ItemList
          rows={rows}
          now={p.now}
          squadId={p.squadId}
          squadNames={p.squadNames}
          fixtureConnection={v.fixture}
          share={(r, shared) => sharing({ sourceIds: [r.id], shared })}
          onChanged={load}
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
                Delete {plural(c.sources.total, 'imported item')}
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
          Deleted {plural(purged.sources, 'source')} and {plural(purged.chunks, 'text excerpt')}.
        </Notice>
      ) : null}
    </Card>
  );
}

const reviewedKey = (id: string) => `squad.reviewed.${id}`;
function isReviewed(id: string): boolean {
  try {
    return localStorage.getItem(reviewedKey(id)) === '1';
  } catch {
    return false;
  }
}
function markReviewed(id: string): void {
  try {
    localStorage.setItem(reviewedKey(id), '1');
  } catch {
    // per-viewer convenience only
  }
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
      <h3 className="sq-conn__h3">Connect with the Squad browser extension</h3>
      <p className="sq-conn__meta">
        Recommended: uses your signed-in Canvas session, nothing is stored on our side except what
        you choose to import. No Canvas password or API token is given to Squad.
      </p>
      {!present ? (
        <Notice
          tone="info"
          title="Extension not detected"
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
          Install the unpacked extension, then press Check again.
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
              <Button size="sm" variant="primary" onClick={() => void authorize(a)}>
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
      {!present ? (
        <div className="sq-conn__actions">
          <Button
            size="sm"
            variant="secondary"
            data-testid="use-canvas-demo"
            disabled={!p.client}
            onClick={() => void p.run((h) => h.connectDemo('canvas'))}
          >
            Use Canvas demo workspace
          </Button>
          <span className="sq-conn__meta">
            Labelled demo data, not your Canvas. Use it to try Squad without the extension.
          </span>
        </div>
      ) : null}
      <details className="sq-conn__fallback" open={!present}>
        <summary>Install steps (unpacked extension)</summary>
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
    <Card className="sq-conn__card">
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
      {p.googleLive === false ? (
        <p className="sq-conn__meta" data-testid="google-no-client">
          No Google OAuth client is configured on this server (GOOGLE_OAUTH_CLIENT_ID,
          GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI). Connect Google shows a labelled
          demo consent screen; the demo workspace is simulated data, not your account.
        </p>
      ) : null}
      <div className="sq-conn__actions">
        {p.googleLive === false ? (
          <Button
            size="sm"
            variant="secondary"
            data-testid="use-google-demo"
            disabled={!p.client}
            onClick={() => void p.run((h) => h.connectDemo('google'))}
          >
            Use Google demo workspace
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="primary"
          data-testid="connect-google"
          disabled={!p.client}
          onClick={() => void startGoogle(p)}
        >
          Connect Google
        </Button>
      </div>
    </Card>
  );
}

export { MSG, bridgeRequest };
export type { HubClient };
