import { useState } from 'react';
import { Button, NightScene } from '@squad/web';
import { STUDENTS } from './session';
import type { SquadSession } from '@squad/web';
import './signin.css';

export function SignInStub({ onSignIn }: { onSignIn: (s: SquadSession) => void }) {
  const [picked, setPicked] = useState<string>(STUDENTS[0]!.id);
  const student = STUDENTS.find((s) => s.id === picked)!;
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
          <Button
            variant="primary"
            size="lg"
            fullWidth
            iconEnd="arrow-right"
            onClick={() =>
              onSignIn({
                userId: student.id,
                name: student.name,
                token: `dev-${student.id}`,
                avatarUrl: student.avatarUrl,
              })
            }
          >
            Enter the village as {student.name}
          </Button>
        </div>
      </main>
    </NightScene>
  );
}
