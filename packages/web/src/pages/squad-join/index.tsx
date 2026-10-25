import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  formatInviteCode,
  parseInviteInput,
  type InvitePreview,
  type SquadDetail,
} from '@squad/core';
import { useAccount } from '../../auth/AuthProvider';
import { AuthStage } from '../../auth/AuthStage';
import { AccountApiError } from '../../auth/errors';
import { rememberNext } from '../../auth/storage';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { TextField } from '../../primitives/TextField';
import { inviteProblem } from './states';
import '../../auth/auth.css';
import './join.css';

type View =
  | { kind: 'entry' }
  | { kind: 'loading' }
  | { kind: 'preview'; preview: InvitePreview }
  | { kind: 'problem'; error: AccountApiError; preview?: InvitePreview }
  | { kind: 'joined'; squad: SquadDetail };

function Heading({ children }: { children: string }) {
  return (
    <h1 className="sq-auth__title" tabIndex={-1} data-autofocus>
      {children}
    </h1>
  );
}

function CodePill({ code }: { code: string }) {
  return (
    <span className="sq-join__code" aria-label={`Invite code ${code}`}>
      {code}
    </span>
  );
}

function Entry({ initial, error }: { initial?: string; error?: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState(initial ?? '');
  const [err, setErr] = useState<string | undefined>(error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = parseInviteInput(text);
    if (!code) {
      setErr(
        'That does not look like an invite. Codes have 8 letters and numbers, like ABCD-EFGH.',
      );
      return;
    }
    navigate(`/join/${formatInviteCode(code)}`);
  };
  return (
    <form className="sq-auth__step sq-auth__form" onSubmit={submit} noValidate>
      <div className="sq-auth__head">
        <p className="sq-auth__tag">Join a squad</p>
        <Heading>Got an invite?</Heading>
        <p className="sq-auth__lede">Paste the link you were sent, or type the 8 character code.</p>
      </div>
      <TextField
        label="Invite link or code"
        value={text}
        onChange={(v) => {
          const parsed = parseInviteInput(v);
          // a pasted link collapses to the code so people can see what they are joining with
          setText(parsed && v.length > 12 ? formatInviteCode(parsed) : v);
          setErr(undefined);
        }}
        error={err}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        placeholder="ABCD-EFGH"
      />
      <div className="sq-auth__actions">
        <Button type="submit" variant="primary" size="lg" fullWidth iconEnd="arrow-right">
          Look up squad
        </Button>
        <Link to="/squad" className="sq-auth__link">
          Not now
        </Link>
      </div>
    </form>
  );
}

/** Public invite page: preview first, sign in if needed, then join. */
export default function SquadJoinPage() {
  const { code: param } = useParams();
  const navigate = useNavigate();
  const account = useAccount();
  const [view, setView] = useState<View>({ kind: param ? 'loading' : 'entry' });
  const [busy, setBusy] = useState(false);
  const code = param ? parseInviteInput(param) : null;
  const pretty = code ? formatInviteCode(code) : '';
  const attempt = useRef(0);

  useEffect(() => {
    document.title = 'Join a squad · Squad';
  }, []);

  const load = useCallback(async () => {
    if (!param) return setView({ kind: 'entry' });
    if (!code)
      return setView({ kind: 'problem', error: new AccountApiError('invite_invalid', 404) });
    const mine = ++attempt.current;
    setView({ kind: 'loading' });
    try {
      const preview = await account.client.previewInvite(code);
      if (mine !== attempt.current) return;
      setView(
        preview.full
          ? { kind: 'problem', error: new AccountApiError('squad_full', 409), preview }
          : { kind: 'preview', preview },
      );
    } catch (e) {
      if (mine !== attempt.current) return;
      setView({
        kind: 'problem',
        error: e instanceof AccountApiError ? e : new AccountApiError('unknown'),
      });
    }
    // account.client is stable for the life of the provider
  }, [param, code]);

  useEffect(() => {
    void load();
  }, [load]);

  const signedIn = account.status === 'signed-in';
  const preview =
    view.kind === 'preview' ? view.preview : view.kind === 'problem' ? view.preview : undefined;

  const join = async () => {
    if (!code || busy) return;
    setBusy(true);
    try {
      const r = await account.client.joinInvite(code);
      await account.refresh().catch(() => {});
      setView({ kind: 'joined', squad: r.squad });
    } catch (e) {
      const err = e instanceof AccountApiError ? e : new AccountApiError('unknown');
      if (err.code === 'unauthorized') {
        rememberNext(`/join/${pretty}`);
        navigate(`/welcome?next=${encodeURIComponent(`/join/${pretty}`)}`);
        return;
      }
      setView({
        kind: 'problem',
        error: err,
        preview: view.kind === 'preview' ? view.preview : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => {
    rememberNext(`/join/${pretty}`);
    navigate(`/welcome?next=${encodeURIComponent(`/join/${pretty}`)}`);
  };

  const switchToExisting = async (err: AccountApiError) => {
    if (busy) return;
    setBusy(true);
    try {
      await account.refresh().catch(() => {});
      const target =
        err.squadId ??
        account.squads.find((s) => preview && s.name === preview.squadName)?.id ??
        null;
      if (target) await account.switchSquad(target);
      navigate('/squad');
    } catch (e) {
      setView({ kind: 'problem', error: e instanceof AccountApiError ? e : err, preview });
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (view.kind === 'entry') body = <Entry />;
  else if (view.kind === 'loading')
    body = (
      <div className="sq-auth__form sq-auth__step" aria-busy="true" aria-label="Checking invite">
        <Skeleton width={96} height={8} />
        <Skeleton height={28} />
        <Skeleton height={72} />
        <Skeleton height={48} />
      </div>
    );
  else if (view.kind === 'preview') {
    const p = view.preview;
    body = (
      <div className="sq-auth__step">
        <div className="sq-auth__head">
          <p className="sq-auth__tag">You are invited</p>
          <p className="sq-join__from">{p.invitedBy} invited you to join</p>
          <Heading>{p.squadName}</Heading>
        </div>
        <ul className="sq-join__facts" aria-label="About this squad">
          {p.course ? (
            <li>
              <Icon name="book" size={16} />
              <span>{p.course}</span>
            </li>
          ) : null}
          {p.memberCount !== null ? (
            <li>
              <Icon name="users" size={16} />
              <span>{p.memberCount} people so far</span>
            </li>
          ) : null}
          <li>
            <Icon name="link" size={16} />
            <CodePill code={pretty} />
          </li>
        </ul>
        <div className="sq-auth__actions">
          {signedIn ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              onClick={() => void join()}
              iconEnd="arrow-right"
            >
              Join {p.squadName}
            </Button>
          ) : account.status === 'loading' ? (
            <Button variant="primary" size="lg" fullWidth loading>
              Checking your account
            </Button>
          ) : (
            <>
              <Button variant="primary" size="lg" fullWidth onClick={signIn} iconEnd="arrow-right">
                Sign in to join
              </Button>
              <p className="sq-auth__fine">
                <Icon name="info" size={14} />
                <span>It takes a minute, and you will come right back to this invite.</span>
              </p>
            </>
          )}
        </div>
      </div>
    );
  } else if (view.kind === 'problem') {
    const e = view.error;
    const prob = inviteProblem(e.code, view.preview?.squadName);
    const already = e.code === 'already_member';
    body = (
      <div className="sq-auth__step" role="alert">
        <div className="sq-join__problem">
          <span className="sq-join__badge" aria-hidden="true">
            <Icon name={prob.icon} size={22} />
          </span>
          <Heading>{prob.title}</Heading>
          <p className="sq-auth__lede sq-join__body">{prob.body}</p>
          {pretty && !already ? <CodePill code={pretty} /> : null}
        </div>
        <div className="sq-auth__actions">
          {already ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={busy}
              onClick={() => void switchToExisting(e)}
            >
              Switch to it
            </Button>
          ) : null}
          {e.code === 'network' || e.code === 'unknown' || e.code === 'rate_limited' ? (
            <Button variant="primary" size="lg" fullWidth onClick={() => void load()}>
              Try again
            </Button>
          ) : null}
          {e.code === 'unauthorized' ? (
            <Button variant="primary" size="lg" fullWidth onClick={signIn}>
              Sign in to join
            </Button>
          ) : null}
          {prob.another ? (
            <Button
              as="a"
              href="/join"
              variant={e.code === 'squad_full' ? 'secondary' : 'primary'}
              size="lg"
              fullWidth
              onClick={(ev) => {
                ev.preventDefault();
                navigate('/join');
              }}
            >
              Try another code
            </Button>
          ) : null}
          <Link to={signedIn ? '/squad' : '/welcome'} className="sq-auth__link">
            {signedIn ? 'Back to Squad' : 'Create an account instead'}
          </Link>
        </div>
      </div>
    );
  } else {
    const s = view.squad;
    body = (
      <div className="sq-auth__step">
        <div className="sq-join__problem">
          <span className="sq-join__badge is-ok" aria-hidden="true">
            <Icon name="check" size={22} />
          </span>
          <p className="sq-auth__tag">You are in</p>
          <Heading>{`Welcome to ${s.name}`}</Heading>
          <p className="sq-auth__lede sq-join__body">
            {s.course ? `${s.course}. ` : ''}It is now your active squad.
          </p>
        </div>
        <div className="sq-auth__actions">
          <Button
            as="a"
            href="/squad"
            variant="primary"
            size="lg"
            fullWidth
            iconEnd="arrow-right"
            onClick={(ev) => {
              ev.preventDefault();
              navigate('/squad');
            }}
          >
            Go to my squad
          </Button>
          <Link to="/squad/members" className="sq-auth__link">
            See who is here
          </Link>
        </div>
      </div>
    );
  }

  return <AuthStage label="Join a squad">{body}</AuthStage>;
}
