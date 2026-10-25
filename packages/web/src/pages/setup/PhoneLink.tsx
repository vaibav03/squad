import { useEffect, useState } from 'react';
import { Button } from '../../primitives/Button';
import { Notice } from '../../primitives/Notice';
import { TextField } from '../../primitives/TextField';
import { HubError, phoneLinks, phoneStart, phoneVerify, type PhoneStartResult } from './api';
import { formatPhone, phoneDigits, validateCode, validatePhone } from './model';

type PhoneInfo = Extract<PhoneStartResult, { challengeId: string }>;

/** The "Link your phone number" sub-option of the Messaging step: a code is texted to the number, then verified. */
export function PhoneLink({
  hubUrl,
  token,
  onLinked,
}: {
  hubUrl: string;
  token: string | null;
  onLinked?: () => void;
}) {
  const ctx = { hubUrl, token };
  const [number, setNumber] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const phoneErr = touched ? validatePhone(number) : null;
  const codeErr = codeTouched ? validateCode(code) : null;

  const done = (h: string | null) => {
    setHint(h);
    setVerified(true);
    onLinked?.();
  };

  // A phone already linked on this account shows as linked (the hub is the source of truth).
  useEffect(() => {
    let alive = true;
    phoneLinks({ hubUrl, token }).then(
      (r) => {
        if (alive && r.links.length > 0) {
          setHint(r.links[0]!.hint);
          setVerified(true);
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [hubUrl, token]);

  const reset = () => {
    setVerified(false);
    setCodeSent(false);
    setCode('');
    setCodeTouched(false);
    setInfo(null);
    setUnavailable(null);
    setError(null);
  };

  if (verified)
    return (
      <div className="sq-setup__stack">
        <Notice tone="ok" title="Phone linked">
          {hint ? `The number ending ${hint.slice(-4)}` : 'Your number'} is verified and linked to
          your account. Your agent can now text you in iMessage.
        </Notice>
        <Button variant="secondary" onClick={reset}>
          Use a different number
        </Button>
      </div>
    );

  const send = async () => {
    setTouched(true);
    if (validatePhone(number)) return;
    setBusy(true);
    setError(null);
    setUnavailable(null);
    try {
      const r = await phoneStart(ctx, `+1${phoneDigits(number)}`);
      if ('alreadyLinked' in r) done(r.to);
      else if (!r.ok) setUnavailable(r.message);
      else {
        setInfo(r);
        setCodeSent(true);
      }
    } catch (e) {
      setError(
        e instanceof HubError && e.code === 'phone_in_use'
          ? 'That number is already linked to another account.'
          : e instanceof HubError && e.code === 'rate_limited'
            ? 'Too many tries. Wait a little and try again.'
            : e instanceof HubError && e.code === 'offline'
              ? 'Cannot reach Squad right now. Try again.'
              : 'We could not send a code. Check the number and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setCodeTouched(true);
    if (validateCode(code) || !info) return;
    setBusy(true);
    setError(null);
    try {
      const r = await phoneVerify(ctx, info.challengeId, code);
      done(r.hint);
    } catch (e) {
      const c = e instanceof HubError ? e.code : '';
      setError(
        c === 'code_invalid'
          ? `That code is not right.${e instanceof HubError && e.triesLeft !== undefined ? ` ${e.triesLeft} tries left.` : ''}`
          : c === 'code_expired'
            ? 'That code expired. Change the number to get a new one.'
            : c === 'too_many_attempts'
              ? 'Too many tries. Change the number to get a new code.'
              : 'We could not verify that code. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="sq-setup__stack"
      onSubmit={(e) => {
        e.preventDefault();
        void (codeSent ? verify() : send());
      }}
      noValidate
    >
      <p className="sq-setup__lede">
        Your number only connects iMessage to your own agent. Other students never see it, and Squad
        keeps only a hash and the last four digits.
      </p>
      <TextField
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        prefix="+1"
        value={number}
        placeholder="(555) 010-0101"
        onChange={(v) => setNumber(formatPhone(v))}
        onBlur={() => setTouched(true)}
        error={phoneErr ?? undefined}
        disabled={codeSent}
      />
      {unavailable ? (
        <Notice tone="warn" title="Code delivery unavailable">
          {unavailable}. Nothing was sent. You can link your phone later.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="warn" title="Phone not linked">
          {error}
        </Notice>
      ) : null}
      {codeSent && info ? (
        <>
          <Notice tone="info" title={info.deliveryLabel}>
            <span data-testid="phone-delivery" data-delivery={info.delivery}>
              {info.delivery === 'imessage'
                ? `We texted a code by iMessage to the number ending ${info.to.slice(-4)}.`
                : 'No text was sent. Squad is in developer mode, so the code is shown here.'}
            </span>
            {info.devCode ? (
              <>
                {' '}
                <strong>
                  {info.devCodeLabel ?? 'Dev code'}:{' '}
                  <code data-testid="phone-dev-code">{info.devCode}</code>
                </strong>
              </>
            ) : null}
          </Notice>
          <TextField
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            onBlur={() => setCodeTouched(true)}
            error={codeErr ?? undefined}
          />
          <div className="sq-setup__inline">
            <Button variant="secondary" type="submit" loading={busy}>
              Verify
            </Button>
            <Button variant="ghost" onClick={reset}>
              Change number
            </Button>
          </div>
        </>
      ) : (
        <div className="sq-setup__inline">
          <Button variant="secondary" type="submit" loading={busy}>
            Send code
          </Button>
        </div>
      )}
    </form>
  );
}
