import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Avatar } from '../../primitives/Avatar';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { ErrorState, OfflineState, EmptyState } from '../../primitives/EmptyState';
import { Icon } from '../../primitives/Icon';
import { IconButton } from '../../primitives/IconButton';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { RadioCards } from '../../primitives/RadioCards';
import { Sheet } from '../../primitives/Sheet';
import { Skeleton } from '../../primitives/Skeleton';
import { Tabs } from '../../primitives/Tabs';
import { TextField } from '../../primitives/TextField';
import { useToast } from '../../primitives/Toast';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import {
  fetchPersonas,
  fetchPreviewBlob,
  fetchVoiceStatus,
  fetchVoices,
  savePersona,
  VoicesUnavailable,
  type VoiceStatus,
} from './api';
import { PERSONAS, VOICES, type PersonaDraft, type VoiceOption } from './fixtures';
import { initPersonas, isDirty, personasReducer } from './model';
import { PreviewPlayer, type PreviewState } from './preview-audio';
import { PIXEL_CAST, pixelPortrait } from '../../pixel/portraits';
import './personas.css';

type Load =
  | { status: 'loading' }
  | { status: 'error'; offline: boolean }
  | { status: 'ready'; personas: PersonaDraft[]; voices: VoiceOption[] };

export default function PersonasPage() {
  const cfg = useSquadConfig();
  const { setTitle } = useShell();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setTitle('Study buddies');
  }, [setTitle]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    if (cfg.mode === 'mock' || !cfg.hubUrl) {
      const t = setTimeout(
        () => !cancelled && setLoad({ status: 'ready', personas: PERSONAS, voices: VOICES }),
        250,
      );
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    const ctx = { hubUrl: cfg.hubUrl, token: cfg.token };
    Promise.all([fetchPersonas(ctx, PERSONAS), fetchVoices(ctx, VOICES)]).then(
      ([personas, voices]) =>
        !cancelled &&
        setLoad({
          status: 'ready',
          // Personas the hub has no voice for yet start on the first voice the hub offers.
          personas: personas.map((p) =>
            voices.some((v) => v.id === p.voiceId)
              ? p
              : { ...p, voiceId: voices[0]?.id ?? p.voiceId },
          ),
          voices,
        }),
      (e: unknown) => !cancelled && setLoad({ status: 'error', offline: e instanceof TypeError }),
    );
    return () => {
      cancelled = true;
    };
  }, [cfg.mode, cfg.hubUrl, cfg.token, attempt]);

  return (
    <Page title="Study buddies" eyebrow="Studio" className="sq-pz">
      {load.status === 'loading' ? <Loading /> : null}
      {load.status === 'error' ? (
        load.offline ? (
          <OfflineState onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <ErrorState title="Could not load personas" onRetry={() => setAttempt((n) => n + 1)} />
        )
      ) : null}
      {load.status === 'ready' ? (
        load.personas.length === 0 ? (
          <EmptyState
            icon="users"
            title="No personas yet"
            body="Personas appear here once your squad is set up."
          />
        ) : (
          <Studio personas={load.personas} voices={load.voices} />
        )
      ) : null}
    </Page>
  );
}

function Loading() {
  return (
    <div className="sq-pz__loading" aria-busy="true" aria-label="Loading personas">
      <Skeleton height={44} />
      <div className="sq-pz__grid">
        <Skeleton shape="block" height={320} />
        <Skeleton shape="block" height={320} />
      </div>
    </div>
  );
}

function Studio({ personas, voices }: { personas: PersonaDraft[]; voices: VoiceOption[] }) {
  const cfg = useSquadConfig();
  const { toast } = useToast();
  const [state, dispatch] = useReducer(personasReducer, personas, initPersonas);
  const draft = state.drafts[state.selected]!;
  const dirty = isDirty(state);
  const player = useMemo(() => new PreviewPlayer(), []);
  const [playing, setPlaying] = useState<string | null>(null);
  const [pstate, setPstate] = useState<PreviewState>('idle');
  const [level, setLevel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // the hub says whether voices can speak at all (and "Checking services..." while it finds out)
  const [vstatus, setVstatus] = useState<VoiceStatus | null>(null);
  const [vmsg, setVmsg] = useState<string | null>(null);
  useEffect(() => {
    if (cfg.mode === 'mock' || !cfg.hubUrl) return;
    let dead = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const s = await fetchVoiceStatus({ hubUrl: cfg.hubUrl!, token: cfg.token });
      if (dead) return;
      setVstatus(s);
      t = setTimeout(() => void poll(), s?.probing ? 1500 : 60_000);
    };
    void poll();
    return () => {
      dead = true;
      if (t) clearTimeout(t);
    };
  }, [cfg.mode, cfg.hubUrl, cfg.token]);
  const voicesOff = !!vstatus && !vstatus.probing && !vstatus.available;

  useEffect(() => {
    const offL = player.onLevel(setLevel);
    const offS = player.onState((s) => {
      setPstate(s);
      if (s === 'idle' || s === 'error' || s === 'blocked' || s === 'unsupported') setPlaying(null);
    });
    return () => {
      offL();
      offS();
      player.stop();
    };
  }, [player]);

  const toggle = useCallback(
    async (v: VoiceOption) => {
      if (playing === v.id) {
        player.stop();
        return;
      }
      setVmsg(null);
      if (voicesOff && vstatus?.notice) {
        setVmsg(vstatus.notice);
        return;
      }
      setPlaying(v.id);
      if (cfg.mode !== 'mock' && cfg.hubUrl) {
        try {
          await player.playBlob(
            await fetchPreviewBlob({ hubUrl: cfg.hubUrl, token: cfg.token }, v.id, draft.sample),
          );
        } catch (e) {
          if (e instanceof VoicesUnavailable) setVmsg(e.message);
          else setPstate('error');
          setPlaying(null);
        }
      } else {
        await player.play(v, draft.sample);
      }
    },
    [player, playing, cfg, draft.sample, voicesOff, vstatus],
  );

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const select = (id: string) => {
    if (id === state.selected) return;
    if (dirty) {
      setPending(id);
      return;
    }
    player.stop();
    dispatch({ type: 'select', id });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      if (cfg.mode !== 'mock' && cfg.hubUrl)
        await savePersona({ hubUrl: cfg.hubUrl, token: cfg.token }, draft);
      else await new Promise((r) => setTimeout(r, 450));
      dispatch({ type: 'saved', id: draft.id });
      toast({ title: `${draft.name} saved`, tone: 'ok' });
    } catch {
      setSaveError(true);
    }
    setSaving(false);
  };

  const talking = playing !== null && pstate === 'playing';
  const voice = voices.find((v) => v.id === draft.voiceId);
  const tabs = personas.map((p) => ({ value: p.id, label: p.name }));

  return (
    <>
      <Tabs
        variant="pill"
        value={state.selected}
        onValueChange={select}
        items={tabs}
        label="Personas"
        panelId="pz"
        className="sq-pz__tabs"
      />
      <div
        className="sq-pz__grid"
        id={`pz-panel-${state.selected}`}
        role="tabpanel"
        aria-labelledby={`pz-tab-${state.selected}`}
      >
        <Card className="sq-pz__identity sq-scene" padding="lg">
          <div className="sq-pz__stage">
            <Avatar
              name={draft.name}
              src={pixelPortrait(draft.avatarId)}
              size="xl"
              frame="portrait"
              pixel
              state={talking ? 'talking' : 'idle'}
              level={level}
            />
          </div>
          <h2 className="sq-pz__name">{draft.name}</h2>
          <p className="sq-pz__role">{draft.role}</p>
          <p className="sq-pz__blurb">{draft.blurb}</p>
          <div className="sq-pz__chips">
            {voice ? <Chip icon="volume">{voice.name}</Chip> : null}
            {dirty ? (
              <Chip tone="ember">Unsaved changes</Chip>
            ) : (
              <Chip tone="ok" icon="check">
                Saved
              </Chip>
            )}
          </div>
          <p className="sq-sr-only" role="status" aria-live="polite">
            {talking ? 'Playing sample' : ''}
          </p>
        </Card>

        <div className="sq-pz__pickers">
          <section aria-labelledby="pz-voice">
            <h3 id="pz-voice" className="sq-pz__h">
              Voice
            </h3>
            <RadioCards
              legend="Voice"
              hideLegend
              value={draft.voiceId}
              onValueChange={(voiceId) => dispatch({ type: 'edit', patch: { voiceId } })}
              options={voices.map((v) => ({
                value: v.id,
                label: v.name,
                description: `${v.character}`,
                trailing: (
                  <IconButton
                    label={playing === v.id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                    icon={playing === v.id ? 'pause' : 'play'}
                    variant="secondary"
                    pressed={playing === v.id}
                    onClick={() => toggle(v)}
                  />
                ),
              }))}
            />
            {vstatus?.probing ? (
              <Notice tone="info" title="Checking services...">
                Voice previews are available once the check finishes.
              </Notice>
            ) : null}
            {voicesOff || vmsg ? (
              <div data-testid="voices-unavailable">
                <Notice tone="warn" title="Voice previews are off">
                  {vmsg ?? vstatus?.notice}
                </Notice>
              </div>
            ) : null}
            {pstate === 'blocked' ? (
              <Notice tone="warn" title="Tap play to hear it">
                Your browser waits for a tap before it plays sound.
              </Notice>
            ) : null}
            {pstate === 'unsupported' ? (
              <Notice tone="warn" title="Audio is not available">
                This browser cannot play voice previews.
              </Notice>
            ) : null}
            {pstate === 'error' ? (
              <Notice tone="error" title="Could not play the sample">
                Try another voice or try again in a moment.
              </Notice>
            ) : null}
            <TextField
              label="Try a line"
              value={draft.sample}
              onChange={(sample) => dispatch({ type: 'edit', patch: { sample } })}
              multiline
              rows={2}
              hint="The sample reads this out loud."
              className="sq-pz__sample"
            />
          </section>

          <section aria-labelledby="pz-avatar">
            <h3 id="pz-avatar" className="sq-pz__h">
              Avatar
            </h3>
            <div className="sq-pz__avatars" role="radiogroup" aria-label="Avatar">
              {PIXEL_CAST.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={pixelPortrait(draft.avatarId) === pixelPortrait(a.id)}
                  aria-label={a.label}
                  title={a.role}
                  className="sq-pz__avatar"
                  onClick={() => dispatch({ type: 'edit', patch: { avatarId: a.id } })}
                >
                  <img
                    className="sq-pz__avatar-img"
                    src={pixelPortrait(a.id)}
                    alt=""
                    width="64"
                    height="64"
                    draggable={false}
                  />
                  <span className="sq-pz__avatar-name" aria-hidden="true">
                    {a.label}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {saveError ? (
            <Notice
              tone="error"
              title="Could not save"
              action={
                <Button size="sm" variant="secondary" onClick={save}>
                  Try again
                </Button>
              }
            >
              Your changes are still here. Check your connection and retry.
            </Notice>
          ) : null}
        </div>
      </div>

      <div className="sq-pz__bar">
        <div className="sq-pz__barinner">
          <span className="sq-pz__barmsg">
            <Icon name={dirty ? 'info' : 'check'} size={16} />
            {dirty ? 'You have unsaved changes' : 'All changes saved'}
          </span>
          <div className="sq-pz__barbtns">
            <Button
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => dispatch({ type: 'reset' })}
            >
              Reset
            </Button>
            <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>

      <Sheet
        open={pending !== null}
        onClose={() => setPending(null)}
        side="center"
        title="Discard your changes?"
        description={`You changed ${draft.name} but have not saved.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                dispatch({ type: 'reset' });
                if (pending) dispatch({ type: 'select', id: pending });
                player.stop();
                setPending(null);
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        <p>Switching personas will drop your unsaved voice and avatar choices.</p>
      </Sheet>
    </>
  );
}
