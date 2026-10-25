import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import './tabs.css';

export interface TabItem {
  value: string;
  label: string;
  icon?: IconName;
  badge?: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  items: TabItem[];
  variant?: 'underline' | 'pill';
  /** id prefix used to wire tabs to panels (TabPanel uses the same). */
  panelId?: string;
  label?: string;
  className?: string;
}

export function Tabs({
  value,
  onValueChange,
  items,
  variant = 'underline',
  panelId = 'tabs',
  label,
  className,
}: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((i) => !i.disabled);
  const onKey = (e: KeyboardEvent) => {
    const idx = enabled.findIndex((i) => i.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next]!;
    onValueChange(target.value);
    refs.current[target.value]?.focus();
  };
  return (
    <div
      className={['sq-tabs', `sq-tabs--${variant}`, className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
    >
      {items.map((it) => {
        const selected = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[it.value] = el;
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${it.value}`}
            aria-selected={selected}
            aria-controls={`${panelId}-panel-${it.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={it.disabled}
            className="sq-tab"
            onClick={() => onValueChange(it.value)}
          >
            {it.icon ? <Icon name={it.icon} size={16} /> : null}
            <span>{it.label}</span>
            {it.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  value,
  active,
  panelId = 'tabs',
  children,
}: {
  value: string;
  active: boolean;
  panelId?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${panelId}-panel-${value}`}
      aria-labelledby={`${panelId}-tab-${value}`}
      hidden={!active}
      tabIndex={0}
    >
      {active ? children : null}
    </div>
  );
}
