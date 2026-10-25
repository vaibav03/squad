const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Expires in 6 days", "Expires in 3 hours", "Expires soon", "Expired". */
export function formatExpiry(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'Expired';
  if (ms < HOUR) return 'Expires in under an hour';
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    return `Expires in ${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const d = Math.floor(ms / DAY);
  return `Expires in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "Single use", "Used 2 of 5", "Anyone with the link". */
export function formatUses(maxUses: number | null, uses: number): string {
  if (maxUses === null)
    return uses > 0 ? `Used ${uses} ${uses === 1 ? 'time' : 'times'}` : 'Anyone with the link';
  if (maxUses === 1) return uses >= 1 ? 'Single use, used' : 'Single use';
  return `Used ${uses} of ${maxUses}`;
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
