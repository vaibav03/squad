import { useState, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import type { CouncilResult } from '@squad/core';
import { LvIcon } from '../overlays/kit/icons';

/** Where the verdict goes next, with the run id as context so the chat can quote it. */
export const discussInChatHref = (runId: string): string =>
  `/squad/chat?seed=${encodeURIComponent(runId)}`;
export const planFromVerdictHref = (runId: string, kind: 'study' | 'trip' = 'study'): string =>
  `/squad/chat?wizard=${kind}&seed=${encodeURIComponent(runId)}`;

function Go({
  to,
  primary,
  icon,
  children,
}: {
  to: string;
  primary?: boolean;
  icon: 'users' | 'clock';
  children: ReactNode;
}) {
  const inRouter = useInRouterContext();
  const cls = `lv-btn${primary ? ' lv-btn--primary' : ''}`;
  const body = (
    <>
      <LvIcon name={icon} size={16} />
      {children}
    </>
  );
  return inRouter ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <a href={to} className={cls}>
      {body}
    </a>
  );
}

const key = (id: string) => `squad.council.accepted.${id}`;
const readAccepted = (id: string): boolean => {
  try {
    return sessionStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
};

/**
 * What to do with a finished verdict. One primary action: discuss it in the group chat with the verdict attached.
 * Then: make a plan from it (the chat's plan helper opens with the verdict as its starting point), accept it, or edit
 * the question and ask again.
 */
export function ResultActions({
  result,
  onEdit,
}: {
  result: CouncilResult;
  /** Put the question back in the box so it can be changed and asked again. */
  onEdit?: () => void;
}) {
  const [accepted, setAccepted] = useState(() => readAccepted(result.id));
  if (!result.verdict || result.status === 'refused' || result.status === 'failed') return null;
  const accept = () => {
    setAccepted(true);
    try {
      sessionStorage.setItem(key(result.id), '1');
    } catch {
      /* private mode: the state lives for this screen only */
    }
  };
  return (
    <section className="cn-result-actions" role="group" aria-label="What to do with this decision">
      <Go to={discussInChatHref(result.id)} primary icon="users">
        Discuss in chat
      </Go>
      <Go to={planFromVerdictHref(result.id)} icon="clock">
        Make a plan from this
      </Go>
      {accepted ? (
        <span className="cn-dim cn-small" role="status">
          Decision accepted. Discuss it in chat to share it with your group.
        </span>
      ) : (
        <button type="button" className="lv-btn" onClick={accept}>
          <LvIcon name="check" size={16} />
          Accept decision
        </button>
      )}
      {onEdit ? (
        <button type="button" className="lv-btn lv-btn--ghost" onClick={onEdit}>
          Edit question
        </button>
      ) : null}
    </section>
  );
}
