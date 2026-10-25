export function splitEvenly(totalCents: number, payers: string[]): Record<string, number> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || payers.length === 0) throw new RangeError('bad split input');
  const base = Math.floor(totalCents / payers.length);
  let rem = totalCents - base * payers.length;
  const out: Record<string, number> = {};
  for (const p of payers) {
    out[p] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}

/** Venmo charge link. Format is UNVERIFIED against the live app: one-line fix here. */
export function venmoLink(o: { payee: string; amountCents: number; note: string }): string {
  const amount = `${Math.floor(o.amountCents / 100)}.${String(o.amountCents % 100).padStart(2, '0')}`;
  const enc = (x: string): string => encodeURIComponent(x).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `https://venmo.com/${enc(o.payee)}?txn=charge&amount=${amount}&note=${enc(o.note)}`;
}
