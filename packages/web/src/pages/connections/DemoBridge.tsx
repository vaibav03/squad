import { useCallback, useEffect, useState } from 'react';
import { timedFetch } from '../../lib/http';
import { Button } from '../../primitives/Button';
import { TextField } from '../../primitives/TextField';
import { useSquadConfig } from '../../shell/context';

interface DemoState {
  available: boolean;
  on: boolean;
  blockedBy?: string;
  label: string;
}

/**
 * The Demo/Fixture iMessage bridge switch. Runs the whole loop (iMessage in, same web group, @squad, mirrored out,
 * delivery states) on a scripted transport: no Sendblue credentials, nothing is ever sent. Off until you press Start.
 */
export function DemoBridge() {
  const cfg = useSquadConfig();
  const [st, setSt] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('@squad what is due this week?');
  const [msg, setMsg] = useState('');
  const headers = useCallback(
    () => ({
      'content-type': 'application/json',
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    }),
    [cfg.token],
  );
  const load = useCallback(async () => {
    if (!cfg.hubUrl) return;
    try {
      const r = await timedFetch(`${cfg.hubUrl}/v1/imessage/demo`, { headers: headers() });
      setSt(r.ok ? ((await r.json()) as DemoState) : null);
    } catch {
      setSt(null);
    }
  }, [cfg.hubUrl, headers]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!st) return null;
  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await timedFetch(`${cfg.hubUrl}${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
        setMsg(`Could not do that (${j.error?.code ?? r.status}).`);
      }
    } catch {
      setMsg('The hub did not answer.');
    } finally {
      setBusy(false);
      await load();
    }
  };
  return (
    <section data-testid="connections-demo-bridge" aria-label="Demo iMessage bridge">
      <h4 className="sq-conn__h3">Demo bridge (no Sendblue needed)</h4>
      <p className="sq-conn__meta" data-testid="demo-bridge-state" data-on={st.on ? '1' : '0'}>
        <strong>{st.on ? 'Demo bridge is ON' : 'Demo bridge is off'}</strong>: {st.label}. Messages
        are marked &quot;via iMessage (demo)&quot; and are never sent anywhere.
      </p>
      {!st.available ? (
        <p className="sq-conn__meta">Not available in a production configuration.</p>
      ) : st.blockedBy === 'another_bridge_running' ? (
        <p className="sq-conn__meta">
          Another iMessage bridge is running; stop it to use the demo.
        </p>
      ) : st.on ? (
        <>
          <TextField label="Text from the demo phone" value={text} onChange={(v) => setText(v)} />
          <Button
            data-testid="demo-bridge-send"
            disabled={busy || !text.trim()}
            onClick={() => void post('/v1/imessage/demo/inbound', { text })}
          >
            Send as the demo phone
          </Button>{' '}
          <Button
            data-testid="demo-bridge-stop"
            disabled={busy}
            onClick={() => void post('/v1/imessage/demo', { enabled: false })}
          >
            Stop demo bridge
          </Button>
        </>
      ) : (
        <Button
          data-testid="demo-bridge-start"
          disabled={busy}
          onClick={() => void post('/v1/imessage/demo', { enabled: true })}
        >
          Start demo bridge
        </Button>
      )}
      {msg ? <p role="alert">{msg}</p> : null}
    </section>
  );
}
