import type { IconName } from '../../primitives/icon-names';
import type { ClientErrorCode } from '../../auth/errors';

export interface InviteProblem {
  icon: IconName;
  title: string;
  body: string;
  /** Offer "try another code". */
  another: boolean;
}

/** Every way an invite can fail, with plain words and a next step. No color-only signals. */
export function inviteProblem(code: ClientErrorCode, squadName?: string): InviteProblem {
  switch (code) {
    case 'invite_expired':
      return {
        icon: 'calendar',
        title: 'This invite has expired',
        body: 'Invites only last a little while. Ask whoever sent it to share a fresh link.',
        another: true,
      };
    case 'invite_revoked':
      return {
        icon: 'x',
        title: 'This invite was cancelled',
        body: 'The squad owner turned this link off. Ask them for a new one.',
        another: true,
      };
    case 'invite_used_up':
      return {
        icon: 'users',
        title: 'This invite has been used up',
        body: 'It was a one time link and someone already used it. Ask for another.',
        another: true,
      };
    case 'squad_full':
      return {
        icon: 'users',
        title: squadName ? `${squadName} is full` : 'This squad is full',
        body: 'There is no room right now. Ask the owner to make space, then try the link again.',
        another: true,
      };
    case 'already_member':
      return {
        icon: 'check',
        title: squadName ? `You are already in ${squadName}` : 'You are already in this squad',
        body: 'No need to join again. You can switch to it from here.',
        another: false,
      };
    case 'rate_limited':
      return {
        icon: 'lock',
        title: 'Too many tries for now',
        body: 'Give it a minute, then try the code again.',
        another: false,
      };
    case 'network':
      return {
        icon: 'link',
        title: 'Squad cannot be reached',
        body: 'Check your connection. Your invite is still good.',
        another: false,
      };
    case 'unauthorized':
      return {
        icon: 'lock',
        title: 'Sign in to join',
        body: 'You need to sign in first. We will bring you right back.',
        another: false,
      };
    case 'invite_invalid':
    case 'not_found':
      return {
        icon: 'alert',
        title: 'We could not find that invite',
        body: 'Check the code for typos, or ask for a new link.',
        another: true,
      };
    default:
      return {
        icon: 'alert',
        title: 'Something went wrong',
        body: 'We could not check that invite. Try again in a moment.',
        another: false,
      };
  }
}
