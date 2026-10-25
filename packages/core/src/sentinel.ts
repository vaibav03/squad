/** Sentinel-leak utility: fake withheld values that must never appear in events or rendered text. */
export const SENTINELS = ['$180', 'therapy'] as const;

export class SentinelLeakError extends Error {
  constructor(
    public readonly sentinel: string,
    public readonly where: string,
  ) {
    super(`withheld sentinel "${sentinel}" leaked in ${where}`);
    this.name = 'SentinelLeakError';
  }
}

/** Returns the first leaked sentinel (case-insensitive), or undefined. */
export function findLeak(
  value: unknown,
  sentinels: readonly string[] = SENTINELS,
): string | undefined {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const hay = text.toLowerCase();
  return sentinels.find((s) => hay.includes(s.toLowerCase()));
}

/** Throws if any sentinel appears in the serialized value (an event, a list of events, a DOM string...). */
export function assertNoLeak(
  value: unknown,
  sentinels: readonly string[] = SENTINELS,
  where = 'serialized output',
): void {
  const items = Array.isArray(value) ? value : [value];
  items.forEach((item, i) => {
    const s = findLeak(item, sentinels);
    if (s) throw new SentinelLeakError(s, Array.isArray(value) ? `${where}[${i}]` : where);
  });
}
