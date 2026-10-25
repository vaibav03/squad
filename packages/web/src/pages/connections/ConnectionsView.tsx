import { useEffect, useState } from 'react';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { TextField } from '../../primitives/TextField';
import type { Connection, HubClient, SourceRow } from './api';
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
  CALENDAR_KINDS,
  errorCopy,
  FIXTURE_LABEL,
  KIND_LABEL,
  kindCounts,
  oauthReturn,
  relTime,
  scopeWords,
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
  return (
    <div className="sq-conn">
      <p className="sq-conn__lede">
        Bring your Canvas and Google context into Squad. Everything is read-only, private to you by
        default, and shared with a squad only when you choose. Disconnecting deletes what was
        imported.
      </p>
      {ret ? (
        <Notice
          tone={ret.ok ? 'ok' : 'error'}
          title={ret.ok ? 'Google connected' : 'Google did not connect'}
        >
          {ret.ok
            ? 'Your first sync is running.'
            : ret.message
              ? errorCopy(ret.message)
              : errorCopy('')}
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
          <CanvasSection p={p} items={canvas} />
          <GoogleSection p={p} items={google} />
        </>
      ) : null}
    </div>
  );
}

function CanvasSection({ p, items }: { p: ViewProps; items: Connection[] }) {
  return (
    <section aria-labelledby="sq-conn-canvas" className="sq-conn__section">
      <h2 id="sq-conn-canvas" className="sq-conn__h">
        Canvas
      </h2>
      {items.map((c) => (
        <ConnectionCard key={c.id} c={c} p={p} />
      ))}
      <CanvasConnect p={p} />
    </section>
  );
}

function GoogleSection({ p, items }: { p: ViewProps; items: Connection[] }) {
  return (
    <section aria-labelledby="sq-conn-google" className="sq-conn__section">
      <h2 id="sq-conn-google" className="sq-conn__h">
        Google Workspace
      </h2>
      {items.map((c) => (
        <ConnectionCard key={c.id} c={c} p={p} />
      ))}
      <GoogleConnect p={p} />
    </section>
  );
}

function ConnectionCard({ c, p }: { c: Connection; p: ViewProps }) {
  const [confirm, setConfirm] = useState(false);
  const [purged, setPurged] = useState<{ sources: number; chunks: number } | null>(null);
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const live = c.state !== 'revoked';
  const counts = kindCounts(c.sources.byKind);
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
        <Chip tone={STATE_TONE[c.state]}>{c.state.replace('_', ' ')}</Chip>
        {c.mode === 'fixture' ? <Chip tone="violet">{FIXTURE_LABEL}</Chip> : null}
        {c.syncPhase === 'syncing' ? <Chip tone="ember">Syncing</Chip> : null}
      </div>
      <p className="sq-conn__state">{c.stateLabel}</p>
      {c.state === 'rate_limited' && c.retryAfter ? (
        <p className="sq-conn__meta">Will retry {relTime(c.retryAfter, p.now)}.</p>
      ) : null}
      {c.note ? <p className="sq-conn__meta">{c.note}</p> : null}
      <dl className="sq-conn__facts">
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
          {c.sharedWithSquads.length ? c.sharedWithSquads.join(', ') : 'nobody (private to you)'}
        </dd>
        <dt>Access</dt>
        <dd>
          <ul className="sq-conn__scopes">
            {c.scopes.map((s) => (
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
            onClick={() =>
              void p.run((h) => (c.variant === 'session' ? h.canvasSync(c.id) : h.sync(c.id)))
            }
          >
            Sync now
          </Button>
          {c.state === 'expired' || c.state === 'error' ? (
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void p.client?.sources(c.id).then(setRows)}
              >
                Choose what to share
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
      {rows ? (
        <ul className="sq-conn__sources" aria-label="Sources">
          {rows.map((r) => {
            const shared = !!p.squadId && r.sharedWith.includes(p.squadId);
            return (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={() => {
                      void sharing({ sourceIds: [r.id], shared: !shared })?.then(() =>
                        p.client?.sources(c.id).then(setRows),
                      );
                    }}
                  />{' '}
                  {r.title}{' '}
                  <span className="sq-conn__meta">
                    ({KIND_LABEL[r.kind] ?? r.kind}
                    {CALENDAR_KINDS.has(r.kind) ? ', event: share one at a time' : ''})
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
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
  useEffect(() => onExtensionReady(() => setPresent(true)), []);
  useEffect(() => {
    if (present) void canvasStatus().then(setStatus);
  }, [present]);
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
        The extension reads Canvas with your own signed-in browser session. No Canvas password or
        API token is given to Squad.{' '}
        <a href="https://github.com/vaibav03/squad/blob/main/apps/extension/README.md">
          Install instructions
        </a>
      </p>
      {!present ? (
        <Notice tone="info" title="Extension not detected">
          Install the unpacked extension, reload this page, and sign in to Canvas in this browser.
        </Notice>
      ) : status === null ? (
        <p role="status">Asking the extension</p>
      ) : status.accounts.length === 0 ? (
        <Notice tone="info" title="No Canvas sign-in detected">
          Sign in to your school Canvas in this browser and open any Canvas page once, then reload.
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
      <details className="sq-conn__fallback">
        <summary>No extension? Paste your Canvas calendar feed URL</summary>
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
      <div className="sq-conn__actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!p.client}
          onClick={() => void startGoogle(p)}
        >
          Continue to Google
        </Button>
      </div>
    </Card>
  );
}

export { MSG, bridgeRequest };
export type { HubClient };
