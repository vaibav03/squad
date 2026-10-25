/**
 * Leak scanner shared by the gate (outbound), the ledger (labels) and the tests.
 * Needles are built from an agent's private fields. Errors and results NEVER carry the matched value:
 * only the category label ("budget cap"), which is public by design.
 */
export interface PrivateFields {
  budget?: number;
  events?: { title: string }[];
  hardNos?: { reason: string }[];
  weakTopics?: string[];
  /** Any other private strings/numbers (e.g. sentinel values in tests). */
  secrets?: (string | number)[];
}

export interface Needle {
  kind: 'text' | 'num';
  /** lowercase text, or digit string */
  value: string;
  /** alnum-only form for text needles (evasion by punctuation) */
  collapsed?: string;
  /** whole-string needle (never dropped by the public allowlist) vs single word */
  whole: boolean;
  category: string;
}

const MIN_TEXT = 3;
const MIN_WORD = 5;
const collapse = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function textNeedles(s: string, category: string): Needle[] {
  const t = s.trim().toLowerCase();
  if (t.length < MIN_TEXT) return [];
  const out: Needle[] = [{ kind: 'text', value: t, collapsed: collapse(t), whole: true, category }];
  for (const w of t.split(/[^a-z0-9]+/)) {
    if (w.length >= MIN_WORD && w !== t)
      out.push({ kind: 'text', value: w, collapsed: w, whole: false, category });
  }
  return out;
}

function numNeedles(n: number, category: string): Needle[] {
  if (!Number.isFinite(n)) return [];
  const digits = String(Math.trunc(Math.abs(n)));
  const out: Needle[] = [{ kind: 'num', value: digits, whole: true, category }];
  if (digits.length > 3) {
    out.push({ kind: 'num', value: Number(digits).toLocaleString('en-US'), whole: true, category });
  }
  return out;
}

export function buildNeedles(f: PrivateFields): Needle[] {
  const out: Needle[] = [];
  if (f.budget !== undefined) out.push(...numNeedles(f.budget, 'budget cap'));
  for (const e of f.events ?? []) out.push(...textNeedles(e.title, 'event title'));
  for (const h of f.hardNos ?? []) out.push(...textNeedles(h.reason, 'hard-no reason'));
  for (const t of f.weakTopics ?? []) out.push(...textNeedles(t, 'weak topic'));
  for (const s of f.secrets ?? []) {
    out.push(
      ...(typeof s === 'number' ? numNeedles(s, 'private value') : textNeedles(s, 'private value')),
    );
  }
  return out;
}

const HEX_BLOB = /^[0-9a-f]{32,}$/;

function stringHits(s: string, n: Needle): boolean {
  if (HEX_BLOB.test(s)) return false; // schema pins these to hex; random digits are not text
  const low = s.toLowerCase();
  if (n.kind === 'num') {
    const esc = n.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`).test(low);
  }
  if (low.includes(n.value)) return true;
  return (
    n.collapsed !== undefined && n.collapsed.length >= MIN_TEXT && collapse(s).includes(n.collapsed)
  );
}

/** Returns the category of the first leaked private value found anywhere in `value` (keys and values), or undefined. */
export function findPrivateLeak(
  value: unknown,
  needles: readonly Needle[],
  publicTokens: ReadonlySet<string> = new Set(),
): string | undefined {
  const live = needles
    .filter((n) => n.whole || !publicTokens.has(n.value))
    .filter((n) => !publicTokens.has(n.value) || (n.whole && n.kind === 'text'));
  const walk = (v: unknown): string | undefined => {
    if (typeof v === 'string') {
      for (const n of live) {
        if (n.kind === 'num' && publicTokens.has(n.value)) continue;
        if (stringHits(v, n)) return n.category;
      }
    } else if (typeof v === 'number') {
      if (Math.abs(v) >= 100) {
        for (const n of live) {
          if (
            n.kind === 'num' &&
            !publicTokens.has(n.value) &&
            n.value === String(Math.trunc(Math.abs(v)))
          )
            return n.category;
        }
      }
    } else if (Array.isArray(v)) {
      for (const x of v) {
        const r = walk(x);
        if (r) return r;
      }
    } else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const r = walk(k) ?? walk(x);
        if (r) return r;
      }
    }
    return undefined;
  };
  return walk(value);
}
