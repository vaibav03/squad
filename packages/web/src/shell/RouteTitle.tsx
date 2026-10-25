import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { routeTitleFor } from './routes';

/**
 * Keeps document.title on the router location, for every route (shell pages, sign-in, welcome, 404).
 * Mount it once inside the router. Pages may refine the title through the shell; a navigation resets it.
 */
export function RouteTitle() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const t = routeTitleFor(pathname);
    document.title = t ? `${t} · Squad` : 'Squad';
  }, [pathname]);
  return null;
}
