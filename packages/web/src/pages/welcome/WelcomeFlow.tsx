import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DISPLAY_NAME_MAX,
  normalizeEmail,
  normalizePhone,
  type AuthStartResponse,
  type ContactChannel,
  type SessionResponse,
} from '@squad/core';
import { useAccount } from '../../auth/AuthProvider';
import { OtpInput } from '../../auth/OtpInput';
import { isApiError, resolveDeadline, userMessage } from '../../auth/errors';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Spinner } from '../../primitives/Spinner';
import { TextField } from '../../primitives/TextField';
import '../../auth/auth.css';

type Step = 'name' | 'contact' | 'code';
const STEPS: Step[] = ['name', 'contact', 'code'];

// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\u0000-\u001f<>]/;

export interface WelcomeFlowProps {
  /** Runs after a verified code. The page decides where to go. */
  onVerified?: (session: SessionResponse) => void;
  /** Developer sign-in link, only when the hub says dev login is on. */
  devHref?: string | null;
}

export function WelcomeFlow({ onVerified, devHref }: WelcomeFlowProps) {
  const account = useAccount();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<ContactChannel>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [challenge, setChallenge] = useState<AuthStartResponse | null>(null);
  const [code, setCode] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [contactError, setContactError] = useState<string | undefined>();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState<'start' | 'verify' | 'resend' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const contactRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const verifying = useRef(false);

  // focus the first thing that matters on each step
  useEffect(() => {
    if (step === 'name') nameRef.current?.focus();
    else if (step === 'contact') contactRef.current?.focus();
  }, [step, channel]);

  // one tick a second, only while a code is waiting
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const resendAt = challenge ? resolveDeadline(challenge.resendAfter) : 0;
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const stepIndex = STEPS.indexOf(step);

  const submitName = (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n || BAD_NAME.test(n)) {
      setNameError('Add a name your squad will recognize.');
      return;
    }
    setNameError(undefined);
    setStep('contact');
  };
  const skipName = () => {
    setName('');
    setNameError(undefined);
    setStep('contact');
  };

  const begin = (res: AuthStartResponse) => {
    setChallenge(res);
    setCode('');
    setCodeError(null);
    setLocked(false);
    setNow(Date.now());
    setStep('code');
  };

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    let body: { phone: string } | { email: string };
    if (channel === 'phone') {
      const p = normalizePhone(phone);
      if (!p) return setContactError('Enter a phone number with area code, like 415 555 0132.');
      body = { phone: p };
    } else {
      const m = normalizeEmail(email);
      if (!m) return setContactError('Enter an email like you@school.edu.');
      body = { email: m };
    }
    setContactError(undefined);
    setBusy('start');
    try {
      begin(await account.start({ ...(name.trim() ? { name: name.trim() } : {}), ...body }));
    } catch (err) {
      if (isApiError(err, 'invalid_request') && !name.trim()) {
        setNameError('We could not find you, so we need a name to set you up.');
        setStep('name');
      } else {
        setContactError(userMessage(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value: string) => {
    if (!challenge || verifying.current) return;
    verifying.current = true;
    setBusy('verify');
    setCodeError(null);
    try {
      const session = await account.verify(challenge.challengeId, value);
      onVerified?.(session);
    } catch (err) {
      setCodeError(userMessage(err));
      if (isApiError(err, 'too_many_attempts', 'code_expired')) setLocked(true);
      setCode('');
    } finally {
      verifying.current = false;
      setBusy(null);
    }
  };

  const resend = async () => {
    if (!challenge || busy || wait > 0) return;
    setBusy('resend');
    try {
      begin(await account.resend(challenge.challengeId));
    } catch (err) {
      setCodeError(userMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const target = channel === 'phone' ? 'number' : 'email';

  return (
    <div className="sq-auth__step" key={step}>
      <div className="sq-auth__head">
        <p className="sq-auth__tag">Step {stepIndex + 1} of 3</p>
        <div className="sq-auth__progress" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`sq-auth__pip${i <= stepIndex ? ' is-on' : ''}`} />
          ))}
        </div>
      </div>

      {step === 'name' ? (
        <form className="sq-auth__form" onSubmit={submitName} noValidate>
          <div className="sq-auth__head">
            <h1 className="sq-auth__title" ref={headingRef}>
              What should your squad call you?
            </h1>
            <p className="sq-auth__lede">
              A first name is plenty. It shows on your squad's member list.
            </p>
          </div>
          <TextField
            ref={nameRef}
            label="Your name"
            value={name}
            onChange={(v) => {
              setName(v);
              setNameError(undefined);
            }}
            error={nameError}
            maxLength={DISPLAY_NAME_MAX}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
          />
          <div className="sq-auth__actions">
            <Button type="submit" variant="primary" size="lg" fullWidth iconEnd="arrow-right">
              Continue
            </Button>
            <button type="button" className="sq-auth__link" onClick={skipName}>
              I already have an account
            </button>
          </div>
        </form>
      ) : null}

      {step === 'contact' ? (
        <form className="sq-auth__form" onSubmit={(e) => void sendCode(e)} noValidate>
          <div className="sq-auth__head">
            <h1 className="sq-auth__title" ref={headingRef}>
              Where can we send a code?
            </h1>
            <p className="sq-auth__lede">
              We will send a 6 digit code to confirm it is you. There is no password to remember.
            </p>
          </div>
          <div className="sq-seg" role="radiogroup" aria-label="How should we reach you">
            {(['phone', 'email'] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                className="sq-seg__btn"
                onClick={() => {
                  setChannel(c);
                  setContactError(undefined);
                }}
              >
                {c === 'phone' ? 'Phone' : 'Email'}
              </button>
            ))}
          </div>
          {channel === 'phone' ? (
            <TextField
              ref={contactRef}
              label="Phone number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(v) => {
                setPhone(v);
                setContactError(undefined);
              }}
              error={contactError}
              enterKeyHint="send"
            />
          ) : (
            <TextField
              ref={contactRef}
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(v) => {
                setEmail(v);
                setContactError(undefined);
              }}
              error={contactError}
              enterKeyHint="send"
            />
          )}
          <p className="sq-auth__fine">
            <Icon name="lock" size={14} />
            <span>
              We keep only a scrambled fingerprint of your {target}. Your squad never sees it.
            </span>
          </p>
          <div className="sq-auth__actions">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={busy === 'start'}
              iconEnd="arrow-right"
            >
              Send code
            </Button>
            <button type="button" className="sq-auth__link" onClick={() => setStep('name')}>
              Back
            </button>
          </div>
        </form>
      ) : null}

      {step === 'code' && challenge ? (
        <div className="sq-auth__form">
          <div className="sq-auth__head">
            <h1 className="sq-auth__title" ref={headingRef} tabIndex={-1}>
              Enter your code
            </h1>
            <p className="sq-auth__lede">
              We sent a 6 digit code to <strong>{challenge.to}</strong>.
            </p>
          </div>
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (codeError) setCodeError(null);
            }}
            onComplete={(v) => void verify(v)}
            disabled={busy === 'verify' || locked}
            invalid={!!codeError}
            autoFocus
            describedBy="sq-code-status"
          />
          <div
            id="sq-code-status"
            className={`sq-auth__status${codeError ? ' is-error' : ''}`}
            role={codeError ? 'alert' : 'status'}
          >
            {busy === 'verify' ? (
              <>
                <Spinner size={14} label="Checking" />
                <span>Checking your code</span>
              </>
            ) : codeError ? (
              <>
                <Icon name="alert" size={16} />
                <span>{codeError}</span>
              </>
            ) : null}
          </div>
          {challenge.devCode ? (
            <p className="sq-auth__dev">
              Dev only: code <b>{challenge.devCode}</b>
            </p>
          ) : null}
          <div className="sq-auth__codeline">
            <button
              type="button"
              className="sq-auth__link"
              disabled={wait > 0 || busy !== null}
              onClick={() => void resend()}
            >
              {wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className="sq-auth__link"
              onClick={() => {
                setStep('contact');
                setCode('');
                setCodeError(null);
              }}
            >
              Use a different {target}
            </button>
          </div>
        </div>
      ) : null}

      {devHref && step !== 'code' ? (
        <a className="sq-auth__link" href={devHref}>
          Developer sign-in
        </a>
      ) : null}
    </div>
  );
}
