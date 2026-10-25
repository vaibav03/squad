import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../primitives/Avatar';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Sheet } from '../primitives/Sheet';
import { StatusPill } from './StatusPill';
import { MoreMenu } from './MoreMenu';
import { JourneyProvider, NextStepLine } from './journey-context';
import { Switch } from '../primitives/Switch';
import { useCalmMode } from '../hooks/useCalmMode';
import { routeTitleFor, squadNav } from './routes';
import { FailureState } from './ErrorBoundary';
import { useRenderWatchdog } from './RenderWatchdog';
import { BuildMarker } from './BuildMarker';
import { RateLimitBanner } from './RateLimitBanner';
import { ConnectionBusyBanner } from './ConnectionBusyBanner';
import { ShellContext } from './shell-context';
import type { NavItem } from './types';
import { useTheme, type ThemeChoice } from './useTheme';
import './app-shell.css';

export interface AppShellProps {
  nav?: NavItem[];
  user: { id: string; name: string; avatarUrl?: string };
  /** Kept for host compatibility; the top bar now reads the real system state itself (StatusPill). */
  status?: { connection: 'live' | 'replay' | 'offline'; label?: string };
  onSignOut?: () => void;
  /** Extra account sheet content (the squad switcher). */
  accountExtra?: ReactNode;
  fullBleed?: boolean;
  /** Router adapter so AppShell stays router-agnostic: render a link. */
  renderLink: (item: {
    to: string;
    className: string;
    children: ReactNode;
    'aria-current'?: 'page';
    onClick?: () => void;
    key?: string;
  }) => ReactNode;
  /** Current pathname, to compute the active item. */
  pathname: string;
  children: ReactNode;
}

function Wordmark() {
  return (
    <span className="sq-shell__brand">
      <svg
        className="sq-shell__lantern"
        viewBox="0 0 7 10"
        width="14"
        height="20"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect x="2" y="0" width="3" height="1" fill="var(--sq-wood-lit)" />
        <rect x="1" y="1" width="5" height="1" fill="var(--sq-wood)" />
        <rect x="1" y="2" width="5" height="5" fill="var(--sq-glow)" />
        <rect x="2" y="3" width="3" height="3" fill="var(--sq-glow-core)" />
        <rect x="1" y="7" width="5" height="1" fill="var(--sq-wood)" />
        <rect x="2" y="8" width="3" height="1" fill="var(--sq-wood-lit)" />
      </svg>
      <span className="sq-shell__wordmark">Squad</span>
    </span>
  );
}

export function AppShell({
  nav = squadNav,
  user,
  onSignOut,
  accountExtra,
  fullBleed: fullBleedProp = false,
  renderLink,
  pathname,
  children,
}: AppShellProps) {
  // A page may refine the title (for example "Trip: Cabo"); the override only applies to the pathname it was set on,
  // so a navigation always falls back to the title of the destination route.
  const [override, setOverride] = useState<{ path: string; title: string } | null>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const routeTitle = routeTitleFor(pathname);
  const title = (override && override.path === pathname && override.title) || routeTitle;
  const [actions, setActions] = useState<ReactNode>(null);
  const [fullBleedState, setFullBleed] = useState<boolean | null>(null);
  const fullBleed = fullBleedState ?? fullBleedProp;
  const [account, setAccount] = useState(false);
  const [more, setMore] = useState(false);
  const [theme, setTheme] = useTheme();
  const [calm, setCalm] = useCalmMode();
  const mainRef = useRef<HTMLElement>(null);
  const [pageKey, setPageKey] = useState(0);
  const dog = useRenderWatchdog(mainRef, `${pathname}:${pageKey}`);

  const setTitle = useCallback((t: string) => setOverride({ path: pathRef.current, title: t }), []);
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = title ? `${title} · Squad` : 'Squad';
  }, [title]);
  const api = useMemo(() => ({ setTitle, setActions, setFullBleed }), [setTitle]);

  // route change: move focus to main without scrolling; reset page-provided state
  const first = useRef(true);
  useEffect(() => {
    setActions(null);
    setFullBleed(null as unknown as boolean);
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [pathname]);

  const sorted = [...nav].sort((a, b) => a.order - b.order);
  const primary = sorted.filter((n) => n.primary);
  const secondary = sorted.filter((n) => !n.primary);
  const isPrefix = (to: string) =>
    pathname === to || (to !== '/squad' && pathname.startsWith(`${to}/`));
  const isActive = (to: string) => {
    const item = sorted.find((n) => n.to === to);
    return isPrefix(to) || !!item?.also?.some(isPrefix);
  };
  const moreActive = secondary.some((n) => isActive(n.to));

  const link = (n: NavItem, cls: string, children: ReactNode, onClick?: () => void) =>
    renderLink({
      key: n.key,
      to: n.to,
      className: `${cls}${isActive(n.to) ? ' is-active' : ''}`,
      'aria-current': isActive(n.to) ? 'page' : undefined,
      children,
      onClick,
    });

  const themes: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <ShellContext.Provider value={api}>
      <JourneyProvider refreshKey={pathname}>
        <div className={`sq-shell${fullBleed ? ' is-bleed sq-scene' : ''}`}>
          <a className="sq-shell__skip" href="#main">
            Skip to content
          </a>
          <header className="sq-shell__header">
            <div className="sq-shell__bar">
              {renderLink({
                to: '/squad',
                className: 'sq-shell__home',
                'aria-current': undefined,
                children: <Wordmark />,
                key: 'home',
              })}
              <nav className="sq-shell__nav" aria-label="Main">
                {primary.map((n) =>
                  link(
                    n,
                    'sq-shell__navlink',
                    <>
                      <Icon name={n.icon} size={18} />
                      <span>{n.label}</span>
                    </>,
                  ),
                )}
                {secondary.length ? (
                  <MoreMenu
                    items={secondary}
                    active={moreActive}
                    renderItem={(n, close) =>
                      link(
                        n,
                        'sq-shell__moreitem',
                        <>
                          <Icon name={n.icon} size={18} />
                          <span>{n.label}</span>
                        </>,
                        close,
                      )
                    }
                  />
                ) : null}
              </nav>
              <div className="sq-shell__right">
                {actions ? <div className="sq-shell__actions">{actions}</div> : null}
                <span className="sq-shell__status">
                  <StatusPill />
                </span>
                <button
                  type="button"
                  className="sq-shell__account"
                  onClick={() => setAccount(true)}
                  aria-label={`Account menu for ${user.name}`}
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                </button>
              </div>
            </div>
          </header>

          <NextStepLine />
          <RateLimitBanner />
          <ConnectionBusyBanner />

          <main
            id="main"
            ref={mainRef}
            tabIndex={-1}
            className="sq-shell__main"
            aria-label={title || undefined}
            data-route={pathname}
          >
            {dog.stalled ? (
              <FailureState
                title={`${title || 'This page'} did not appear`}
                body="Something went wrong while opening this page."
                onRetry={() => {
                  setPageKey((n) => n + 1);
                  dog.reset();
                }}
              />
            ) : (
              <Fragment key={pageKey}>{children}</Fragment>
            )}
          </main>

          <BuildMarker />

          <nav className="sq-shell__tabs" aria-label="Main">
            {primary.map((n) =>
              link(
                n,
                'sq-shell__tab',
                <>
                  <span className="sq-shell__tabicon">
                    <Icon name={n.icon} size={22} />
                  </span>
                  <span className="sq-shell__tablabel">{n.label}</span>
                </>,
              ),
            )}
            <button
              type="button"
              className={`sq-shell__tab${moreActive ? ' is-active' : ''}`}
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
            >
              <span className="sq-shell__tabicon">
                <Icon name="menu" size={22} />
                {secondary.length ? (
                  <Badge
                    count={secondary.length}
                    tone="ember"
                    label={`${secondary.length} more pages`}
                    className="sq-shell__morebadge"
                  />
                ) : null}
              </span>
              <span className="sq-shell__tablabel">More</span>
            </button>
          </nav>

          <Sheet
            open={more}
            onClose={() => setMore(false)}
            title="More"
            side="bottom"
            scene={fullBleed}
          >
            <ul className="sq-shell__morelist">
              {secondary.map((n) => (
                <li key={n.key}>
                  {link(
                    n,
                    'sq-shell__morelink',
                    <>
                      <Icon name={n.icon} size={20} />
                      <span>{n.label}</span>
                      <Icon name="chevron-right" size={18} />
                    </>,
                    () => setMore(false),
                  )}
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="sq-shell__morelink"
                  onClick={() => {
                    setMore(false);
                    setAccount(true);
                  }}
                >
                  <Icon name="user" size={20} />
                  <span>Account and display</span>
                  <Icon name="chevron-right" size={18} />
                </button>
              </li>
            </ul>
          </Sheet>

          <Sheet
            open={account}
            onClose={() => setAccount(false)}
            title={user.name}
            description="Signed in with the demo account."
            side="center"
            scene={fullBleed}
            footer={
              <Button
                variant="secondary"
                iconStart="arrow-right"
                onClick={() => {
                  setAccount(false);
                  onSignOut?.();
                }}
              >
                Sign out
              </Button>
            }
          >
            <div className="sq-shell__acct">
              {accountExtra}
              <fieldset className="sq-shell__theme">
                <legend>Chrome theme</legend>
                <div className="sq-shell__seg" role="radiogroup" aria-label="Chrome theme">
                  {themes.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={theme === t.value}
                      className="sq-shell__segbtn"
                      onClick={() => setTheme(t.value)}
                    >
                      {t.value === 'light' ? (
                        <Icon name="sun" size={16} />
                      ) : t.value === 'dark' ? (
                        <Icon name="moon" size={16} />
                      ) : null}
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="sq-shell__note">The village is always night.</p>
              </fieldset>
              <Switch checked={calm} onCheckedChange={setCalm} label="Calm mode" />
              <p className="sq-shell__note">
                Calms animation everywhere: fewer, gentler movements.
              </p>
            </div>
          </Sheet>
        </div>
      </JourneyProvider>
    </ShellContext.Provider>
  );
}
