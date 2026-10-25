import { useState } from 'react';
import type { Invite } from '@squad/core';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useCopy } from './clipboard';
import { formatExpiry, formatUses } from './format';
import './auth.css';

/** One invite, ready to share: link first, code on request. Used by squad-create and squad-members. */
export function InviteCard({
  invite,
  onRevoke,
  revoking,
  quiet,
}: {
  invite: Invite;
  /** Owners only. */
  onRevoke?: () => void;
  revoking?: boolean;
  /** Smaller, for lists. */
  quiet?: boolean;
}) {
  const [showCode, setShowCode] = useState(false);
  const link = useCopy();
  const code = useCopy();
  const active = invite.status === 'active';
  return (
    <div className={`sq-invite${quiet ? ' sq-invite--quiet' : ''}${active ? '' : ' is-off'}`}>
      <div className="sq-invite__row">
        <p className="sq-invite__link" title={invite.link}>
          {invite.link.replace(/^https?:\/\//, '')}
        </p>
        <Button
          variant={quiet ? 'secondary' : 'primary'}
          size={quiet ? 'sm' : 'md'}
          iconStart={link.copied ? 'check' : 'link'}
          disabled={!active}
          onClick={() => link.copy(invite.link)}
        >
          {link.copied ? 'Copied' : link.failed ? 'Copy failed' : 'Copy link'}
        </Button>
      </div>
      {showCode ? (
        <div className="sq-invite__codebox">
          <span className="sq-invite__code" aria-label={`Invite code ${invite.code}`}>
            {invite.code}
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconStart={code.copied ? 'check' : undefined}
            disabled={!active}
            onClick={() => code.copy(invite.code)}
          >
            {code.copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
      ) : null}
      <div className="sq-invite__meta">
        <span>
          <Icon name="calendar" size={14} />
          {active
            ? formatExpiry(invite.expiresAt)
            : invite.status === 'revoked'
              ? 'Cancelled'
              : invite.status === 'used_up'
                ? 'Used up'
                : 'Expired'}
        </span>
        <span>
          <Icon name="users" size={14} />
          {formatUses(invite.maxUses, invite.uses)}
        </span>
        <span className="sq-invite__tools">
          <button
            type="button"
            className="sq-auth__link"
            aria-expanded={showCode}
            onClick={() => setShowCode((s) => !s)}
          >
            {showCode ? 'Hide code' : 'Show code'}
          </button>
          {onRevoke && active ? (
            <button
              type="button"
              className="sq-auth__link sq-invite__revoke"
              disabled={revoking}
              onClick={onRevoke}
            >
              Revoke
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
