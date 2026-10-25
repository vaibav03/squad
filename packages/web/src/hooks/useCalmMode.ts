import { useCallback, useEffect, useState } from 'react';

const KEY = 'squad.calm';

function read(): boolean {
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.calm === 'true')
      return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Calm mode: reduced-motion variants everywhere. Persisted, mirrored to <html data-calm>. */
export function useCalmMode(): [boolean, (next: boolean) => void] {
  const [calm, setCalmState] = useState(false);
  useEffect(() => {
    const initial = read();
    setCalmState(initial);
    document.documentElement.dataset.calm = initial ? 'true' : 'false';
    const onChange = (e: Event) => setCalmState((e as CustomEvent<boolean>).detail);
    window.addEventListener('squad:calm', onChange);
    return () => window.removeEventListener('squad:calm', onChange);
  }, []);
  const setCalm = useCallback((next: boolean) => {
    setCalmState(next);
    document.documentElement.dataset.calm = next ? 'true' : 'false';
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* storage blocked: still applies for this session */
    }
    window.dispatchEvent(new CustomEvent('squad:calm', { detail: next }));
  }, []);
  return [calm, setCalm];
}
