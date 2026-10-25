import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Invite, SquadDetail } from '@squad/core';
import { useAccount } from '../../auth/AuthProvider';
import { InviteCard } from '../../auth/InviteCard';
import { userMessage } from '../../auth/errors';
import { Avatar } from '../../primitives/Avatar';
import { Badge } from '../../primitives/Badge';
import { Button } from '../../primitives/Button';
import { Card } from '../../primitives/Card';
import { EmptyState, ErrorState, OfflineState } from '../../primitives/EmptyState';
import { Notice } from '../../primitives/Notice';
import { Page } from '../../primitives/Page';
import { Sheet } from '../../primitives/Sheet';
import { Skeleton } from '../../primitives/Skeleton';
import { useShell } from '../../shell/shell-context';
import '../../auth/auth.css';
import './members.css';

type Confirm =
  | { kind: 'leave' }
  | { kind: 'remove'; id: string; name: string }
  | { kind: 'owner'; id: string; name: string };

/** Members of the active squad, roles, the share-invite card, leave. Owners can promote and remove. */
export default function SquadMembersPage() {
  const account = useAccount();
  const { client, activeSquadId } = account;
  const navigate = useNavigate();
  const { setTitle } = useShell();
  const [squad, setSquad] = useState<SquadDetail | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'offline'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setTitle('Members'), [setTitle]);

  const load = useCallback(async () => {
    if (!activeSquadId) return;
    setState('loading');
    try {
      const s = await client.getSquad(activeSquadId);
      setSquad(s);
      setInvites(await client.listInvites(activeSquadId));
      setState('ready');
    } catch (e) {
      setError(userMessage(e));
      setState(account.online ? 'error' : 'offline');
    }
  }, [client, activeSquadId, account.online]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!activeSquadId)
    return (
      <Page title="Members" width="narrow">
        <EmptyState
          icon="users"
          title="You are not in a squad yet"
          body="Create one or join with a code from a friend."
          action={
            <Button variant="primary" onClick={() => navigate('/welcome/choose')}>
              Get started
            </Button>
          }
        />
      </Page>
    );

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setConfirm(null);
      if (after) after();
      else await load();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const owner = squad?.role === 'owner';

  return (
    <Page title={squad?.name ?? 'Members'} eyebrow={squad?.course ?? 'Squad'} width="narrow">
      {state === 'loading' ? (
        <div aria-busy="true" aria-label="Loading members">
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : state === 'offline' ? (
        <OfflineState onRetry={() => void load()} />
      ) : state === 'error' || !squad ? (
        <ErrorState error={error ? new Error(error) : undefined} onRetry={() => void load()} />
      ) : (
        <div className="sq-members">
          {error ? (
            <Notice tone="error" title="Something went wrong">
              {error}
            </Notice>
          ) : null}
          {squad.memberCount === null ? (
            <Notice tone="info" title="Counts stay private for now">
              Squads of three or more can see shared numbers. Until then, only the people in the
              squad are listed.
            </Notice>
          ) : null}
          <Card padding="md">
            <ul className="sq-members__list">
              {squad.members.map((m) => (
                <li key={m.id} className="sq-members__row">
                  <Avatar name={m.name} {...(m.avatarUrl ? { src: m.avatarUrl } : {})} size="md" />
                  <span className="sq-members__name">
                    {m.name}
                    {m.you ? <span className="sq-members__you"> (you)</span> : null}
                  </span>
                  <Badge
                    tone={m.role === 'owner' ? 'ember' : 'neutral'}
                    label={m.role === 'owner' ? 'Owner' : 'Member'}
                  />
                  {owner && !m.you ? (
                    <span className="sq-members__tools">
                      {m.role !== 'owner' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirm({ kind: 'owner', id: m.id, name: m.name })}
                        >
                          Make owner
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm({ kind: 'remove', id: m.id, name: m.name })}
                      >
                        Remove
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <h2 className="sq-members__h">Invite people</h2>
          {invites
            .filter((i) => i.status === 'active')
            .map((i) => (
              <InviteCard
                key={i.id}
                invite={i}
                {...(owner
                  ? { onRevoke: () => void act(() => client.revokeInvite(squad.id, i.id)) }
                  : {})}
                revoking={busy}
              />
            ))}
          {invites.every((i) => i.status !== 'active') ? (
            <p className="sq-members__empty">No active invite.</p>
          ) : null}
          {owner ? (
            <div className="sq-members__actions">
              <Button
                variant="secondary"
                iconStart="plus"
                loading={busy}
                onClick={() => void act(() => client.createInvite(squad.id, { maxUses: null }))}
              >
                New invite link
              </Button>
              <Button
                variant="ghost"
                loading={busy}
                onClick={() => void act(() => client.createInvite(squad.id, { maxUses: 1 }))}
              >
                Single-use link
              </Button>
            </div>
          ) : null}

          <div className="sq-members__actions">
            <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })}>
              Leave squad
            </Button>
          </div>
        </div>
      )}

      <Sheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm?.kind === 'leave'
            ? 'Leave this squad?'
            : confirm?.kind === 'remove'
              ? `Remove ${confirm.name}?`
              : confirm?.kind === 'owner'
                ? `Make ${confirm.name} an owner?`
                : ''
        }
        side="center"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.kind === 'owner' ? 'primary' : 'danger'}
              loading={busy}
              onClick={() => {
                if (!confirm || !squad) return;
                if (confirm.kind === 'leave')
                  void act(
                    () => client.leaveSquad(squad.id),
                    () => void account.refresh().then(() => navigate('/squad')),
                  );
                else if (confirm.kind === 'remove')
                  void act(() => client.removeMember(squad.id, confirm.id));
                else void act(() => client.setRole(squad.id, confirm.id, 'owner'));
              }}
            >
              {confirm?.kind === 'leave'
                ? 'Leave'
                : confirm?.kind === 'remove'
                  ? 'Remove'
                  : 'Make owner'}
            </Button>
          </>
        }
      >
        <p>
          {confirm?.kind === 'leave'
            ? 'You will lose access to this squad. If you are the last owner, ownership passes to the longest-standing member.'
            : confirm?.kind === 'remove'
              ? 'They will lose access to this squad right away.'
              : 'Owners can invite and remove people and rename the squad.'}
        </p>
      </Sheet>
    </Page>
  );
}
