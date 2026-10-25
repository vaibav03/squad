import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import { IconButton } from './IconButton';
import './notice.css';

export type NoticeTone = 'info' | 'ok' | 'warn' | 'error';
const ICON: Record<NoticeTone, IconName> = { info: 'info', ok: 'check', warn: 'alert', error: 'alert' };

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Notice({ tone = 'info', title, children, action, onDismiss, className }: NoticeProps) {
  return (
    <div className={['sq-notice', `sq-notice--${tone}`, className].filter(Boolean).join(' ')} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="sq-notice__icon"><Icon name={ICON[tone]} size={18} /></span>
      <div className="sq-notice__body">
        {title ? <p className="sq-notice__title">{title}</p> : null}
        {children ? <div className="sq-notice__text">{children}</div> : null}
        {action ? <div className="sq-notice__action">{action}</div> : null}
      </div>
      {onDismiss ? <IconButton label="Dismiss" icon="x" size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}
