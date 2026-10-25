import { useEffect, useState } from 'react';
import {
  PHASE_LABEL,
  PHASE_SENTENCE,
  phaseHasData,
  summarizeConnections,
} from '../../lib/connection-phase';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Notice } from '../../primitives/Notice';
import { RadioCards } from '../../primitives/RadioCards';
import { errorCopy, itemTypeLabel } from '../connections/model';
import {
  canvasAuthorize,
  canvasStatus,
  extensionPresent,
  onExtensionReady,
  type BridgeStatus,
} from '../connections/bridge';
import {
  CATEGORIES,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  DEMO_CANVAS_FEED,
  TOUR_RETURN,
  groupRows,
  sharePlan,
  type ShareCategory,
} from './model';
import type { TourData } from './useTour';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};
const stack: React.CSSProperties = { display: 'grid', gap: 12 };

function PhaseLine({
  phase,
}: {
  phase: ReturnType<typeof summarizeConnections>['canvas']['phase'];
}) {
  return (
    <p style={{ margin: 0 }} data-testid="phase-line" data-phase={phase}>
      <Chip tone={phase === 'demo' ? 'violet' : phase === 'live' ? 'ok' : 'neutral'}>
        {PHASE_LABEL[phase]}
      </Chip>{' '}
      {PHASE_SENTENCE[phase]}
    </p>
  );
}

/** Step 2: connect Canvas (extension or demo) and Google (OAuth when configured, else demo). */
export function ConnectStep({ t }: { t: TourData }) {
  const sum = summarizeConnections(t.connections);
  const [present, setPresent] = useState(extensionPresent());
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<'canvas' | 'google' | null>(null);
  useEffect(() => onExtensionReady(() => setPresent(true)), []);
  useEffect(() => {
    if (present) void canvasStatus().then(setStatus);
  }, [present]);
  const checkAgain = async () => {
    setChecking(true);
    const here = extensionPresent();
    setPresent(here);
    setStatus(here ? await canvasStatus() : null);
    setChecking(false);
  };
  const canvasDemo = async () => {
    setBusy('canvas');
    await t.run((h) => h.connectFeed(DEMO_CANVAS_FEED));
    setBusy(null);
  };
  const google = async () => {
    setBusy('google');
    const r = await t.run((h) => h.googleAuthorize(TOUR_RETURN));
    if (r) window.location.assign(r.authorization_url);
    else setBusy(null);
  };
  const canvasHas = phaseHasData(sum.canvas.phase);
  const googleHas = phaseHasData(sum.calendar.phase);
  return (
    <div style={stack}>
      {t.view === 'demo' || t.view === 'offline' ? (
        <Notice
          tone="warn"
          title={t.view === 'offline' ? 'Cannot reach Squad right now' : 'Sign in to connect'}
        >
          {t.view === 'offline'
            ? 'Nothing was changed. Try again in a moment, or skip and connect later.'
            : 'Connecting needs a signed-in account. You can skip and connect later from Connections.'}
        </Notice>
      ) : null}
      {t.error ? (
        <Notice tone="error" onDismiss={t.clearError}>
          {errorCopy(t.error)}
        </Notice>
      ) : null}
      <Card aria-label="Canvas">
        <div style={stack}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Canvas</h2>
          <PhaseLine phase={sum.canvas.phase} />
          {!canvasHas ? (
            <>
              <p style={{ margin: 0 }} data-testid="canvas-detect">
                <Chip tone={present ? 'ok' : 'neutral'}>
                  {present ? 'Detected' : 'Not detected'}
                </Chip>{' '}
                {present
                  ? 'The Squad browser extension is installed.'
                  : 'Install the extension to use your real Canvas.'}
              </p>
              {!present ? (
                <p style={{ margin: 0 }}>
                  Install the Squad browser extension (steps are under Connections, Canvas), then
                  check again.
                </p>
              ) : status && status.accounts.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {status.accounts.map((a) => (
                    <li key={`${a.origin}#${a.canvasUserId}`} style={row}>
                      <span>
                        {a.name ? `${a.name} on ` : ''}
                        {a.origin}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void canvasAuthorize(a, t.userId ?? '').then(() => t.reload())
                        }
                      >
                        Connect this account
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0 }}>
                  Sign in to your school Canvas in this browser, then check again.
                </p>
              )}
              <div style={row}>
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
                  loading={busy === 'canvas'}
                  disabled={!t.client}
                  onClick={() => void canvasDemo()}
                >
                  Use Canvas demo workspace
                </Button>
                <Chip tone="violet">Demo data</Chip>
              </div>
            </>
          ) : null}
        </div>
      </Card>
      <Card aria-label="Google Workspace">
        <div style={stack}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Google Workspace</h2>
          <PhaseLine phase={sum.calendar.phase} />
          {!googleHas ? (
            <div style={row}>
              {t.googleReady ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === 'google'}
                  onClick={() => void google()}
                >
                  Connect Google
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === 'google'}
                    disabled={!t.client}
                    onClick={() => void google()}
                  >
                    Use Google demo workspace
                  </Button>
                  <Chip tone="violet">Demo data</Chip>
                </>
              )}
            </div>
          ) : null}
          {!googleHas && !t.googleReady ? (
            <p style={{ margin: 0 }}>
              Not set up yet: Google sign-in is not turned on for this Squad, so only demo data is
              available.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** Step 3: what was imported, from each connection. */
export function ReviewStep({ t }: { t: TourData }) {
  if (t.rows === null) return <p role="status">Loading what was imported</p>;
  const g = groupRows(t.rows);
  const demo = t.connections.some((c) => c.mode === 'fixture');
  return (
    <div style={stack} data-testid="review-list">
      {demo ? (
        <Notice tone="info" title="Demo data">
          These are example items, not your account.
        </Notice>
      ) : null}
      {CATEGORIES.map((k) => (
        <Card key={k} aria-label={CATEGORY_LABEL[k]}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>
            {CATEGORY_LABEL[k]} ({g[k].length})
          </h2>
          {g[k].length === 0 ? (
            <p style={{ margin: 0 }}>Nothing imported for this yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {g[k].slice(0, 5).map(({ row: r }) => (
                <li key={r.id}>
                  {r.title} <span style={{ opacity: 0.7 }}>({itemTypeLabel(r.kind)})</span>
                </li>
              ))}
              {g[k].length > 5 ? <li>and {g[k].length - 5} more</li> : null}
            </ul>
          )}
        </Card>
      ))}
      <p style={{ margin: 0 }}>
        Something missing? Your connections keep syncing, and you can review every item later in
        Connections.
      </p>
    </div>
  );
}

/** Step 4: choose what the squad can see. Default Private. Applied by the page's primary button. */
export function ShareStep({
  t,
  chosen,
  setChosen,
}: {
  t: TourData;
  chosen: Record<ShareCategory, boolean>;
  setChosen: (c: Record<ShareCategory, boolean>) => void;
}) {
  if (t.rows === null) return <p role="status">Loading what was imported</p>;
  const g = groupRows(t.rows);
  const squad = (t.squadId && t.squadNames[t.squadId]) || 'your squad';
  return (
    <div style={stack} data-testid="share-list">
      {!t.squadId ? (
        <Notice tone="info">
          Create or join a squad first to share anything. Everything stays private until then.
        </Notice>
      ) : null}
      {CATEGORIES.map((k) => (
        <RadioCards
          key={k}
          legend={`${CATEGORY_LABEL[k]} (${g[k].length}). ${CATEGORY_HINT[k]}`}
          value={chosen[k] ? 'squad' : 'private'}
          onValueChange={(v) => setChosen({ ...chosen, [k]: v === 'squad' })}
          columns={2}
          options={[
            { value: 'private', label: 'Private', description: 'Only you.' },
            {
              value: 'squad',
              label: `Share with ${squad}`,
              description: 'Members can see these.',
              disabled: !t.squadId || g[k].length === 0,
            },
          ]}
        />
      ))}
      <p style={{ margin: 0 }}>You can change any of this later in Connections.</p>
    </div>
  );
}

/** Applies the chosen categories through the connection share API. Returns false if any call failed. */
export async function applyShares(
  t: TourData,
  chosen: Record<ShareCategory, boolean>,
): Promise<boolean> {
  const client = t.client;
  if (!client || !t.squadId || !t.rows) return true;
  const plan = sharePlan(groupRows(t.rows), chosen);
  try {
    for (const [id, sourceIds] of Object.entries(plan))
      await client.share(id, { squadId: t.squadId, sourceIds, shared: true });
    return true;
  } catch {
    return false;
  }
}

export function SkipPanel({ onSkip, onBack }: { onSkip: () => Promise<void>; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Notice
      tone="warn"
      title="Skip connecting for now?"
      action={
        <div style={row}>
          <Button size="sm" variant="secondary" onClick={onBack}>
            Go back
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onSkip().finally(() => setBusy(false));
            }}
          >
            Skip anyway
          </Button>
        </div>
      }
    >
      Agents will have limited context: they can only use what you type or upload. You can connect
      any time from Connections.
    </Notice>
  );
}
