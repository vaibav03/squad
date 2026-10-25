import { useEffect, useState, type ReactNode } from 'react';

/** Renders `fallback` on the server and first client render, then children. Keeps Phaser etc. client-side. */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode | (() => ReactNode);
  fallback?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <>{fallback}</>;
  return <>{typeof children === 'function' ? children() : children}</>;
}
