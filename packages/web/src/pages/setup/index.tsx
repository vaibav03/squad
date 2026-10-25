import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../primitives/Avatar';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Chip } from '../../primitives/Chip';
import { Icon } from '../../primitives/Icon';
import { IconButton } from '../../primitives/IconButton';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { ProgressBar } from '../../primitives/ProgressBar';
import { OfflineState } from '../../primitives/EmptyState';
import { RadioCards } from '../../primitives/RadioCards';
import { Stepper } from '../../primitives/Stepper';
import { TextField } from '../../primitives/TextField';
import { useSquadConfig } from '../../shell/context';
import { useShell } from '../../shell/shell-context';
import { pixelPortrait } from '../../pixel/portraits';
import { HubError, postCalendar, uploadCourse } from './api';
import { demoBlocks, PERSONA_CHOICES, SAMPLE_COURSES } from './fixtures';
import { parseIcs } from './ics';
import { saveSetupDone } from './progress';
import {
  completedSteps,
  formatBytes,
  type Action,
  type SetupState,
  initialState,
  isStepId,
  nextStep,
  prevStep,
  reducer,
  STEPS,
  validateCode,
  validateFile,
  validatePhone,
  type CourseFile,
  type StepId,
} from './model';
import { WeekGrid } from './WeekGrid';
import { ConnectionsStepCard } from '../connections/StepCard';
import './setup.css';

let uid = 0;
const newId = () => `f${++uid}`;

export default function SetupPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { setTitle } = useShell();
  const cfg = useSquadConfig();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stepParam = params.step;
  const done = stepParam === 'done';
  const step: StepId = isStepId(stepParam) ? stepParam : 'phone';
  const headingRef = useRef<HTMLHeadingElement>(null);
  const filesRef = useRef(new Map<string, File>());
  const startedRef = useRef(new Set<string>());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setTitle('Set up');
  }, [setTitle]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step, done]);

  // mock ingest: deterministic progress; live: upload then trust the hub's status
  useEffect(() => {
    const active = state.courses.filter((c) => c.status === 'queued' || c.status === 'reading');
    if (active.length === 0) return;
    if (cfg.mode !== 'mock' && cfg.hubUrl) {
      const ctx = { hubUrl: cfg.hubUrl, token: cfg.token };
      for (const c of active.filter((x) => x.status === 'queued')) {
        if (startedRef.current.has(c.id)) continue;
        startedRef.current.add(c.id);
        const file = filesRef.current.get(c.id);
        dispatch({ type: 'courses/progress', id: c.id, progress: 0.05, status: 'reading' });
        if (!file) continue;
        uploadCourse(ctx, file).then(
          () => {
            dispatch({ type: 'courses/progress', id: c.id, progress: 1, status: 'ready' });
          },
          (e: unknown) => {
            if (e instanceof HubError && e.code === 'offline') setOffline(true);
            dispatch({ type: 'courses/progress', id: c.id, progress: 0, status: 'failed' });
          },
        );
      }
      return;
    }
    const t = setInterval(() => {
      for (const c of active) {
        const next = c.progress + 0.09;
        if (/broken/i.test(c.name) && next > 0.45)
          dispatch({ type: 'courses/progress', id: c.id, progress: c.progress, status: 'failed' });
        else dispatch({ type: 'courses/progress', id: c.id, progress: next });
      }
    }, 280);
    return () => clearInterval(t);
  }, [state.courses, cfg.mode, cfg.hubUrl, cfg.token]);

  const go = useCallback((s: StepId | 'done') => navigate(`/squad/setup/${s}`), [navigate]);
  const completed = completedSteps(state);
  const completedKey = completed.join(',');
  useEffect(() => {
    saveSetupDone(completedKey ? completedKey.split(',') : []);
  }, [completedKey]);
  const canSkip = step === 'calendar' || step === 'persona';
  const next = nextStep(step);
  const prev = prevStep(step);

  let body,
    canContinue = false,
    primaryLabel = 'Continue';
  if (done) {
    body = <DoneStep completed={completed} />;
  } else if (step === 'phone') {
    body = <PhoneStep state={state} dispatch={dispatch} />;
    canContinue = state.phone.verified;
  } else if (step === 'courses') {
    body = (
      <CoursesStep
        state={state}
        dispatch={dispatch}
        filesRef={filesRef}
        offline={offline}
        onRetryOffline={() => setOffline(false)}
      />
    );
    canContinue = state.courses.some((c) => c.status === 'ready');
  } else if (step === 'calendar') {
    body = <CalendarStep state={state} dispatch={dispatch} cfg={cfg} />;
    canContinue = state.calendar.status === 'ready';
  } else {
    body = (
      <PersonaStep state={state} dispatch={dispatch} onStudio={() => navigate('/squad/personas')} />
    );
    canContinue = !!state.persona;
    primaryLabel = 'Finish';
  }

  return (
    <Page
      title={done ? 'You are all set' : 'Set up Squad'}
      eyebrow={
        done ? 'Done' : `Step ${STEPS.findIndex((s) => s.id === step) + 1} of ${STEPS.length}`
      }
      className="sq-setup"
    >
      <div className="sq-setup__layout">
        <aside className="sq-setup__rail" aria-label="Setup progress">
          <Stepper
            steps={[...STEPS]}
            current={done ? '' : step}
            completed={completed}
            onStepClick={(id) => go(id as StepId)}
            orientation="horizontal"
            className="sq-setup__stepper"
          />
        </aside>
        <section className="sq-setup__panel" aria-live="polite">
          {done ? null : (
            <h2 className="sq-setup__h" tabIndex={-1} ref={headingRef}>
              {HEADINGS[step]}
            </h2>
          )}
          {done ? (
            <h2 className="sq-sr-only" tabIndex={-1} ref={headingRef}>
              All set
            </h2>
          ) : null}
          <div key={done ? 'done' : step} className="sq-setup__body">
            {body}
          </div>
        </section>
      </div>
      {done ? null : (
        <div className="sq-setup__bar">
          <div className="sq-setup__barinner">
            {prev ? (
              <Button variant="ghost" iconStart="chevron-left" onClick={() => go(prev)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="sq-setup__barright">
              {canSkip && !canContinue ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    dispatch({ type: 'skip', step });
                    go(next);
                  }}
                >
                  Skip for now
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={!canContinue}
                iconEnd="arrow-right"
                onClick={() => go(next)}
              >
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

const HEADINGS: Record<StepId, string> = {
  phone: 'Link your phone',
  courses: 'Add your course PDFs',
  calendar: 'Share your busy times',
  persona: 'Pick your study buddy',
};

type StepProps = { state: SetupState; dispatch: React.Dispatch<Action> };

function PhoneStep({ state, dispatch }: StepProps) {
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const phoneErr = touched ? validatePhone(state.phone.number) : null;
  const codeErr = codeTouched ? validateCode(code) : null;

  if (state.phone.verified) {
    return (
      <div className="sq-setup__stack">
        <Notice tone="ok" title="Phone linked">
          {state.phone.number} is connected. Your agent can now text you in iMessage.
        </Notice>
        <Button
          variant="secondary"
          onClick={() => {
            dispatch({ type: 'phone/edit' });
            setCode('');
          }}
        >
          Use a different number
        </Button>
      </div>
    );
  }
  return (
    <form
      className="sq-setup__stack"
      onSubmit={(e) => {
        e.preventDefault();
      }}
      noValidate
    >
      <p className="sq-setup__lede">
        Your number only connects iMessage to your own agent. Other students never see it.
      </p>
      <Notice tone="info" title="Demo step">
        Phone linking is a demo for now: the number is not stored and no code is sent.
      </Notice>
      <TextField
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        prefix="+1"
        value={state.phone.number}
        placeholder="(555) 010-0101"
        onChange={(v) => dispatch({ type: 'phone/number', number: v })}
        onBlur={() => setTouched(true)}
        error={phoneErr ?? undefined}
        disabled={state.phone.codeSent}
      />
      {state.phone.codeSent ? (
        <>
          <TextField
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            hint="Demo mode: no text is sent. Enter any 6 digits."
            onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            onBlur={() => setCodeTouched(true)}
            error={codeErr ?? undefined}
          />
          <div className="sq-setup__inline">
            <Button
              variant="primary"
              onClick={() => {
                setCodeTouched(true);
                if (!validateCode(code)) dispatch({ type: 'phone/verified' });
              }}
            >
              Verify
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                dispatch({ type: 'phone/edit' });
                setCode('');
                setCodeTouched(false);
              }}
            >
              Change number
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="primary"
          type="submit"
          onClick={() => {
            setTouched(true);
            if (!validatePhone(state.phone.number)) dispatch({ type: 'phone/sent' });
          }}
        >
          Send code
        </Button>
      )}
    </form>
  );
}

function CoursesStep({
  state,
  dispatch,
  filesRef,
  offline,
  onRetryOffline,
}: StepProps & {
  filesRef: React.MutableRefObject<Map<string, File>>;
  offline: boolean;
  onRetryOffline: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const addFiles = (list: FileList | File[]) => {
    const errs: string[] = [];
    const ok: CourseFile[] = [];
    for (const f of Array.from(list)) {
      const e = validateFile(f);
      if (e) {
        errs.push(e);
        continue;
      }
      const id = newId();
      filesRef.current.set(id, f);
      ok.push({ id, name: f.name, size: f.size, status: 'queued', progress: 0 });
    }
    setErrors(errs);
    if (ok.length) dispatch({ type: 'courses/add', files: ok });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };
  const sample = () =>
    dispatch({
      type: 'courses/add',
      files: SAMPLE_COURSES.map((c) => ({
        id: newId(),
        name: c.name,
        size: c.size,
        status: 'queued' as const,
        progress: 0,
      })),
    });

  if (offline) return <OfflineState onRetry={onRetryOffline} />;
  return (
    <div className="sq-setup__stack">
      <p className="sq-setup__lede">
        Your experts read these chapters, and every answer cites the page it came from.
      </p>
      <div
        className={`sq-drop${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <span className="sq-drop__icon" aria-hidden="true">
          <Icon name="upload" size={24} />
        </span>
        <p className="sq-drop__title">Drop PDFs here</p>
        <p className="sq-drop__hint">Up to 50 MB each</p>
        <input
          ref={input}
          className="sq-sr-only"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={onPick}
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className="sq-setup__inline">
          <Button variant="secondary" iconStart="file" onClick={() => input.current?.click()}>
            Browse files
          </Button>
          <Button variant="ghost" iconStart="sparkle" onClick={sample}>
            Use sample chapters
          </Button>
        </div>
      </div>
      {errors.length ? (
        <Notice tone="error" title="Some files were skipped" onDismiss={() => setErrors([])}>
          {errors.join(' ')}
        </Notice>
      ) : null}
      {state.courses.length ? (
        <ul className="sq-files" aria-label="Your files">
          {state.courses.map((c) => (
            <li key={c.id} className={`sq-file is-${c.status}`}>
              <span className="sq-file__icon" aria-hidden="true">
                <Icon name="file" size={20} />
              </span>
              <div className="sq-file__main">
                <div className="sq-file__top">
                  <span className="sq-file__name">{c.name}</span>
                  <span className="sq-file__size">{formatBytes(c.size)}</span>
                </div>
                {c.status === 'ready' || c.status === 'failed' ? null : (
                  <ProgressBar
                    value={c.status === 'queued' ? 0 : c.progress}
                    label={`Reading ${c.name}`}
                  />
                )}
              </div>
              <Chip
                tone={c.status === 'ready' ? 'ok' : c.status === 'failed' ? 'alert' : 'neutral'}
                icon={c.status === 'ready' ? 'check' : c.status === 'failed' ? 'alert' : undefined}
              >
                {
                  {
                    queued: 'Queued',
                    reading: `Reading ${Math.round(c.progress * 100)}%`,
                    ready: 'Ready',
                    failed: 'Failed',
                  }[c.status]
                }
              </Chip>
              {c.status === 'failed' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => dispatch({ type: 'courses/retry', id: c.id })}
                >
                  Retry
                </Button>
              ) : null}
              <IconButton
                label={`Remove ${c.name}`}
                icon="trash"
                size="sm"
                onClick={() => dispatch({ type: 'courses/remove', id: c.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CalendarStep({
  state,
  dispatch,
  cfg,
}: StepProps & { cfg: ReturnType<typeof useSquadConfig> }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const useDemo = async () => {
    setError(null);
    if (cfg.mode !== 'mock' && cfg.hubUrl) {
      setBusy(true);
      try {
        await postCalendar({ hubUrl: cfg.hubUrl, token: cfg.token }, { demo: true });
      } catch (e) {
        setError(
          e instanceof HubError && e.code === 'offline'
            ? 'Cannot reach the hub. Try again in a moment.'
            : 'We could not load the demo calendar.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    dispatch({ type: 'calendar/set', blocks: demoBlocks(), source: 'demo' });
  };
  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.ics$/i.test(f.name) && f.type !== 'text/calendar') {
      setError(`${f.name} is not a calendar (.ics) file.`);
      return;
    }
    const text = await f.text();
    const blocks = parseIcs(text);
    if (blocks.length === 0) {
      setError('We could not find any timed events in that file.');
      return;
    }
    setError(null);
    if (cfg.mode !== 'mock' && cfg.hubUrl) {
      setBusy(true);
      try {
        await postCalendar({ hubUrl: cfg.hubUrl, token: cfg.token }, { ics: text, name: f.name });
      } catch (err) {
        setError(
          err instanceof HubError && err.code === 'offline'
            ? 'Cannot reach the hub. Try again in a moment.'
            : 'We could not send that calendar to your agent.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    dispatch({ type: 'calendar/set', blocks, source: 'ics' });
  };
  const n = state.calendar.blocks.length;
  return (
    <div className="sq-setup__stack">
      <p className="sq-setup__lede">
        Your agent finds study times that work for everyone. It only sees free or busy, never what
        the event is.
      </p>
      <input
        ref={input}
        className="sq-sr-only"
        type="file"
        accept=".ics,text/calendar"
        onChange={onPick}
        tabIndex={-1}
        aria-hidden="true"
      />
      {state.calendar.status === 'ready' ? (
        <>
          <Notice tone="ok" title={`We found ${n} busy ${n === 1 ? 'block' : 'blocks'}`}>
            {state.calendar.source === 'demo'
              ? 'This is the demo calendar.'
              : 'Read from your calendar file on this device.'}
          </Notice>
          <Card tone="inset">
            <WeekGrid blocks={state.calendar.blocks} />
          </Card>
          <Button variant="secondary" onClick={() => dispatch({ type: 'calendar/clear' })}>
            Choose a different calendar
          </Button>
        </>
      ) : (
        <div className="sq-drop">
          <span className="sq-drop__icon" aria-hidden="true">
            <Icon name="calendar" size={24} />
          </span>
          <p className="sq-drop__title">Add a calendar file</p>
          <p className="sq-drop__hint">Export an .ics file from Google, Apple or Outlook</p>
          <div className="sq-setup__inline">
            <Button variant="secondary" iconStart="upload" onClick={() => input.current?.click()}>
              Upload .ics
            </Button>
            <Button variant="ghost" iconStart="sparkle" loading={busy} onClick={useDemo}>
              Use the demo calendar
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <Notice tone="error" title="Calendar problem" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function PersonaStep({ state, dispatch, onStudio }: StepProps & { onStudio: () => void }) {
  return (
    <div className="sq-setup__stack">
      <p className="sq-setup__lede">
        Pick who you study with. You can change the look and the voice any time in the personas
        studio.
      </p>
      <RadioCards
        legend="Study buddy"
        hideLegend
        value={state.persona ?? ''}
        onValueChange={(id) => dispatch({ type: 'persona/pick', id })}
        options={PERSONA_CHOICES.map((p) => ({
          value: p.id,
          label: p.name,
          description: p.blurb,
          leading: (
            <Avatar
              name={p.name}
              src={pixelPortrait(p.portrait)}
              pixel
              size="lg"
              frame="portrait"
            />
          ),
        }))}
      />
      <Button variant="ghost" iconEnd="arrow-right" onClick={onStudio} className="sq-setup__studio">
        Open the personas studio
      </Button>
    </div>
  );
}

function DoneStep({ completed }: { completed: StepId[] }) {
  const navigate = useNavigate();
  const missing = STEPS.filter((s) => !completed.includes(s.id));
  return (
    <div className="sq-setup__stack sq-setup__done">
      <Avatar name="Squad" src={pixelPortrait('student')} size="xl" frame="portrait" pixel />
      <p className="sq-setup__lede">Your agent is ready. The village is lit and waiting.</p>
      {missing.length ? (
        <Notice tone="info" title="Still to do">
          {missing.map((m) => m.label).join(', ')}. You can finish these later from Home.
        </Notice>
      ) : null}
      <ConnectionsStepCard />
      <Button
        variant="primary"
        size="lg"
        iconEnd="arrow-right"
        onClick={() => navigate('/squad/village')}
      >
        Enter the Village
      </Button>
    </div>
  );
}
