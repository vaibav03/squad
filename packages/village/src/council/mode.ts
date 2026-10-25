/** Honest mode badge words. An icon AND a word, never colour alone. Missing or unknown modes read as Fixture (scripted, wire tier `demo`). */
export type ModeTier = 'live' | 'degraded' | 'demo';
export interface ModeInfo {
  tier: ModeTier;
  /** Visible word: 'Live', 'Degraded: credits depleted', 'Fixture'. */
  word: string;
  /** Short word without the reason: 'Live' | 'Degraded' | 'Fixture'. */
  short: string;
  /** Icon name: 'radio' | 'alert' | 'fixture'. */
  glyph: string;
  /** Plain sentence for a title/tooltip/screen reader. */
  detail: string;
}

/** Icon names (Lucide family, rendered by the web `Icon` primitive). Never a text glyph. */
const GLYPH: Record<ModeTier, string> = { live: 'radio', degraded: 'alert', demo: 'fixture' };
const reasonWords = (r: string): string => r.replace(/[_-]+/g, ' ').trim();

export function modeInfo(mode: string | undefined | null): ModeInfo {
  const m = (mode ?? '').trim().toLowerCase();
  if (m === 'live')
    return {
      tier: 'live',
      word: 'Live',
      short: 'Live',
      glyph: GLYPH.live,
      detail: 'Live: a real model is answering now.',
    };
  if (m.startsWith('degraded')) {
    const r = reasonWords(m.slice('degraded'.length).replace(/^:/, ''));
    return {
      tier: 'degraded',
      word: r ? `Degraded: ${r}` : 'Degraded',
      short: 'Degraded',
      glyph: GLYPH.degraded,
      detail: r ? `Degraded: ${r}. Some answers may be scripted or missing.` : 'Degraded.',
    };
  }
  const r = m.startsWith('demo') ? reasonWords(m.slice('demo'.length).replace(/^:/, '')) : '';
  return {
    tier: 'demo',
    word: 'Fixture',
    short: 'Fixture',
    glyph: GLYPH.demo,
    detail: r
      ? `Fixture (${r}): scripted example text, not a live model.`
      : 'Fixture: scripted example text, not a live model.',
  };
}

const RANK: Record<ModeTier, number> = { live: 0, degraded: 1, demo: 2 };
/** The least honest-to-call-live mode wins: one Demo agent makes the whole council Demo. */
export function worstMode(modes: readonly (string | undefined)[]): string {
  let worst: string | undefined;
  for (const m of modes) {
    if (m === undefined) continue;
    if (worst === undefined || RANK[modeInfo(m).tier] > RANK[modeInfo(worst).tier]) worst = m;
  }
  return worst ?? 'demo';
}
