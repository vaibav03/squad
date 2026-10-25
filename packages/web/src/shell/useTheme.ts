import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'squad.theme';

function apply(choice: ThemeChoice) {
  const el = document.documentElement;
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.dataset.theme = choice;
}

/** Chrome theme (the village itself is always night). Persists in localStorage when available. */
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setChoice(t === 'light' || t === 'dark' ? t : 'system');
  }, []);
  const set = useCallback((c: ThemeChoice) => {
    setChoice(c);
    apply(c);
    try {
      if (c === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* ignore */
    }
  }, []);
  return [choice, set];
}
