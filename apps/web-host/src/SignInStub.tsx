import { useState } from 'react';
import { Button, NightScene, Notice, devLogin } from '@squad/web';
import { STUDENTS } from './session';
import type { SquadSession } from '@squad/web';
import './signin.css';

export function SignInStub({
  onSignIn,
  hubUrl = null,
}: {
  onSignIn: (s: SquadSession) => void;
  hubUrl?: string | null;
}) {
  const [picked, setPicked] = useState<string>(STUDENTS[0]!.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const student = STUDENTS.find((s) => s.id === picked)!;
  const demo = (): SquadSession => ({
    userId: student.id,
    name: student.name,
    token: `dev-${student.id}`,
    avatarUrl: student.avatarUrl,
  });
  const enter = async () => {
    if (!hubUrl) return onSignIn(demo());
    setBusy(true);
    setError(null);
    try {
      onSignIn(await devLogin(hubUrl, student));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <NightScene className="sq-signin sq-scene">
      <main className="sq-signin__main">
        <div className="sq-signin__card">
          <p className="sq-signin__tag">Demo sign-in</p>
          <h1 className="sq-signin__title">Squad</h1>
          <p className="sq-signin__lede">Pick who you are studying as tonight.</p>
          <div className="sq-signin__grid" role="radiogroup" aria-label="Choose a student">
            {STUDENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={picked === s.id}
                className="sq-signin__student"
                onClick={() => setPicked(s.id)}
              >
                <span className="sq-signin__avatar">
                  <img src={s.avatarUrl} alt="" width="64" height="64" />
                </span>
                <span className="sq-signin__name">{s.name}</span>
                <span className="sq-signin__blurb">{s.blurb}</span>
              </button>
            ))}
          </div>
          {error ? (
            <Notice tone="warn" title="Could not reach the hub">
              {error} You can still look around with demo data.
            </Notice>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconEnd="arrow-right"
            loading={busy}
            onClick={() => void enter()}
          >
            {error ? 'Try the hub again' : `Enter the village as ${student.name}`}
          </Button>
          {error ? (
            <Button variant="ghost" fullWidth onClick={() => onSignIn(demo())}>
              Continue with demo data
            </Button>
          ) : null}
        </div>
      </main>
    </NightScene>
  );
}
