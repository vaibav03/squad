const KEY = 'squad.setup.done';

/** Remember which setup steps this browser finished, so Home can show the real checklist. */
export function saveSetupDone(done: readonly string[]): void {
  try {
    const prev = loadSetupDone();
    const merged = Array.from(new Set([...prev, ...done]));
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable: the checklist just stays at To do */
  }
}

export function loadSetupDone(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
