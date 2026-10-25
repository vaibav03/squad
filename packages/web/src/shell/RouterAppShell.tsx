import { Link, useLocation } from 'react-router-dom';
import { AppShell, type AppShellProps } from './AppShell';

/** AppShell wired to react-router-dom. Hosts that use another router use AppShell directly with renderLink. */
export function RouterAppShell(props: Omit<AppShellProps, 'renderLink' | 'pathname'>) {
  const { pathname } = useLocation();
  return (
    <AppShell
      {...props}
      pathname={pathname}
      renderLink={({ key, to, className, children, onClick, ...aria }) => (
        <Link key={key} to={to} className={className} onClick={onClick} {...aria}>
          {children}
        </Link>
      )}
    />
  );
}
