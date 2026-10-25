import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { COURSE_NAME_MAX, SQUAD_NAME_MAX, type Invite, type SquadDetail } from '@squad/core';
import { useAccount } from '../../auth/AuthProvider';
import { InviteCard } from '../../auth/InviteCard';
import { Banner } from '../../auth/Banner';
import { userMessage } from '../../auth/errors';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { TextField } from '../../primitives/TextField';
import { useShell } from '../../shell/shell-context';
import '../../auth/auth.css';
import './create.css';

type Phase =
  | { kind: 'form' }
  | { kind: 'done'; squad: SquadDetail; invite: Invite | null; inviteError: string | null };

/** Name a squad, then hand over an invite link straight away. */
export default function SquadCreatePage() {
  const account = useAccount();
  const navigate = useNavigate();
  const { setTitle } = useShell();
  const [name, setName] = useState('');
  const [course, setCourse] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const created = useRef(false);
  const refreshRef = useRef(account.refresh);
  refreshRef.current = account.refresh;

  useEffect(() => {
    setTitle('Create a squad');
  }, [setTitle]);

  // The squad list refreshes when this page is left, so the success card is not remounted underneath you.
  useEffect(
    () => () => {
      if (created.current) void refreshRef.current().catch(() => {});
    },
    [],
  );

  const makeInvite = async (squad: SquadDetail) => {
    try {
      const invite = await account.client.createInvite(squad.id);
      setPhase({ kind: 'done', squad, invite, inviteError: null });
    } catch (e) {
      setPhase({ kind: 'done', squad, invite: null, inviteError: userMessage(e) });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (n.length < 2) {
      setNameError('Give your squad a name with at least 2 letters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const squad = await account.client.createSquad({
        name: n,
        ...(course.trim() ? { course: course.trim() } : {}),
      });
      created.current = true;
      await makeInvite(squad);
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === 'done') {
    const { squad, invite, inviteError } = phase;
    return (
      <Page title={`${squad.name} is ready`} eyebrow="Squad created" width="narrow">
        <Banner />
        <Card padding="lg" className="sq-create__card">
          <div className="sq-create__lead">
            <h2 className="sq-create__h">Invite your classmates</h2>
            <p className="sq-create__p">
              Share this link or code. Anyone who has it can join
              {squad.course ? ` ${squad.course}` : ''} with you until it expires.
            </p>
          </div>
          {invite ? (
            <InviteCard invite={invite} />
          ) : (
            <Notice
              tone="warn"
              title="Your squad is ready, but the invite is not"
              action={
                <Button variant="secondary" size="sm" onClick={() => void makeInvite(squad)}>
                  Make an invite link
                </Button>
              }
            >
              {inviteError}
            </Notice>
          )}
          <p className="sq-create__note">
            Counts and group numbers stay hidden until 3 people have joined, so nobody is singled
            out.
          </p>
          <div className="sq-create__actions">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              iconEnd="arrow-right"
              onClick={() => {
                // load the new squad into the account BEFORE leaving: the shell sends an account with no squads to
                // /welcome/choose, so navigating first bounced a brand-new squad owner back to the start
                created.current = false;
                void refreshRef
                  .current()
                  .catch(() => {})
                  .then(() => navigate('/squad'));
              }}
            >
              Go to my squad
            </Button>
            <Button variant="ghost" fullWidth onClick={() => navigate('/squad/members')}>
              Manage members and invites
            </Button>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Create a squad" eyebrow="New squad" width="narrow">
      <Banner />
      <Card padding="lg" className="sq-create__card" as="section">
        <form className="sq-create__form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="sq-create__lead">
            <p className="sq-create__p">
              A squad is the small group you study with. You will get an invite link right after.
            </p>
          </div>
          <TextField
            label="Squad name"
            value={name}
            onChange={(v) => {
              setName(v);
              setNameError(undefined);
            }}
            error={nameError}
            hint="Something your group will recognize."
            maxLength={SQUAD_NAME_MAX}
            autoComplete="off"
            required
          />
          <TextField
            label="Course"
            value={course}
            onChange={setCourse}
            hint="Optional. Shown to people you invite."
            maxLength={COURSE_NAME_MAX}
            autoComplete="off"
          />
          {error ? (
            <Notice tone="error" title="Could not create the squad">
              {error}
            </Notice>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            iconEnd="arrow-right"
          >
            Create squad
          </Button>
        </form>
      </Card>
    </Page>
  );
}
