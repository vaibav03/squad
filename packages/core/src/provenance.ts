// Reply provenance (docs/provenance.md): every bot reply says where its content came from, or says plainly that it
// came from nowhere. A grounded reply carries verified citations (chips); everything else carries an explicit label.
// Browser-safe: the hub composes it, the web chat renders it, the iMessage renderer turns it into one plain line.
import { z } from 'zod';
import type { ChatCitation } from './chat';

export const PROVENANCE_MODES = ['live', 'degraded', 'demo'] as const;
export const ProvenanceModeSchema = z.enum(PROVENANCE_MODES);
export type ProvenanceMode = z.infer<typeof ProvenanceModeSchema>;

/**
 * grounded    at least one verified citation (chips are shown and open the source viewer)
 * no_sources  nothing from the course or connected sources was used
 * sample      built from sample/fixture data, not the student's own course (e.g. the fallback study plan)
 * demo        scripted demo model, not Gemini
 * ungrounded  the reply cited sources that could not be verified, so the citations were dropped
 */
export const PROVENANCE_KINDS = ['grounded', 'no_sources', 'sample', 'demo', 'ungrounded'] as const;
export const ProvenanceKindSchema = z.enum(PROVENANCE_KINDS);
export type ProvenanceKind = z.infer<typeof ProvenanceKindSchema>;

export const ProvenanceSchema = z.strictObject({
  kind: ProvenanceKindSchema,
  /** The visible words: `2 sources` for grounded, otherwise one of PROVENANCE_LABELS (or a skill's own label). */
  label: z.string().max(160),
  /** Number of verified citations on the message. */
  sources: z.number().int().nonnegative(),
  mode: ProvenanceModeSchema,
  /** The channel the question came from (the reply travels back the same way). */
  via: z.enum(['web', 'imessage']).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const PROVENANCE_LABELS = {
  no_sources: 'No course sources used',
  sample: 'Not grounded: sample data',
  demo: 'Demo: scripted, not Gemini',
  ungrounded: 'Not grounded: cited sources could not be verified',
} as const;

export const PROVENANCE_MODE_LABELS: Record<ProvenanceMode, string> = {
  live: 'Live',
  degraded: 'Degraded',
  demo: 'Demo',
};

/** What a skill may say about its own reply when it has no citations (the composer decides the rest). */
export interface ProvenanceHint {
  kind?: 'no_sources' | 'sample' | 'demo';
  /** Replaces the default label for that kind (for example `Quiz question from ch6 material, no page cited`). */
  label?: string;
}

/** `[file.pdf p.4]` markers in reply text (same shape the web chat and the bot transport parse). */
const MARKER = /[([]\s*([^()[\]\n,]+?\.[A-Za-z]{2,4})[,\s]+p\.?\s?(\d{1,4})\s*[)\]]/g;
export const hasCitationMarkers = (text: string): boolean => {
  MARKER.lastIndex = 0;
  const found = MARKER.test(text);
  MARKER.lastIndex = 0;
  return found;
};

export interface ComposeInput {
  /** Reply text (markers still in it). */
  text: string;
  /** Citations the skill and the text parser produced; each is checked with `verify`. */
  citations: readonly ChatCitation[];
  /** True when the citation points at something that really exists (the page is in the store, the source is synced). */
  verify: (c: ChatCitation) => boolean;
  mode: ProvenanceMode;
  hint?: ProvenanceHint | undefined;
  via?: 'web' | 'imessage' | undefined;
  /** True when this (verified) citation points at simulated/fixture data. Falls back to `citation.source.provenance`. */
  isFixture?: (c: ChatCitation) => boolean;
}

/** Citation / source chip text: simulated sources never read as real (`Demo: Canvas`, `Demo: Google`). */
export const CONNECTION_PROVIDER_NAME = { canvas: 'Canvas', google: 'Google' } as const;
export const providerOfSourceKind = (kind: string): 'canvas' | 'google' | null =>
  kind.startsWith('canvas_') ? 'canvas' : /^(gcal|gdoc|gdrive|classroom)/.test(kind) ? 'google' : null;
export const sourceChipLabel = (provider: 'canvas' | 'google', fixture: boolean): string =>
  fixture ? `Demo: ${CONNECTION_PROVIDER_NAME[provider]}` : CONNECTION_PROVIDER_NAME[provider];

/**
 * The reply mode after looking at its sources: Live only when the model is live (`mode`) AND no cited source is
 * simulated. Any fixture/demo source makes the reply `demo`: an answer built on simulated data is never "Live".
 */
export function modeForSources(mode: ProvenanceMode, anyFixture: boolean): ProvenanceMode {
  return anyFixture ? 'demo' : mode;
}

export const sourcesWords = (n: number): string => `${n} source${n === 1 ? '' : 's'}`;

/**
 * The ONE place that decides what a reply may claim. Only verified citations survive. A reply with none gets an
 * explicit label; a reply whose text cites pages that did not verify is downgraded to `ungrounded` (never "grounded
 * without chips").
 */
export function composeProvenance(i: ComposeInput): { citations: ChatCitation[]; provenance: Provenance } {
  const seen = new Set<string>();
  const verified: ChatCitation[] = [];
  for (const c of i.citations) {
    const key = `${c.file}#${c.page}#${c.source?.id ?? ''}#${c.source?.anchor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i.verify(c)) verified.push(c);
  }
  const fixture = verified.some((c) => (i.isFixture ? i.isFixture(c) : c.source?.provenance === 'fixture'));
  const base = {
    sources: verified.length,
    mode: modeForSources(i.mode, fixture),
    ...(i.via ? { via: i.via } : {}),
  };
  if (verified.length > 0)
    return {
      citations: verified,
      provenance: {
        kind: 'grounded',
        label: fixture ? `${sourcesWords(verified.length)}, demo data` : sourcesWords(verified.length),
        ...base,
      },
    };
  const claimed = i.citations.length > 0 || hasCitationMarkers(i.text);
  if (claimed)
    return {
      citations: [],
      provenance: { kind: 'ungrounded', label: PROVENANCE_LABELS.ungrounded, ...base },
    };
  const hintKind = i.hint?.kind;
  const kind: Exclude<ProvenanceKind, 'grounded' | 'ungrounded'> =
    hintKind === 'sample'
      ? 'sample'
      : i.mode === 'demo' || hintKind === 'demo'
        ? 'demo'
        : 'no_sources';
  return {
    citations: [],
    provenance: { kind, label: i.hint?.label ?? PROVENANCE_LABELS[kind], ...base },
  };
}

/** The plain-text provenance line for transports without chips (iMessage): `Sources: ...` or the label. */
export function provenanceLine(
  p: Provenance | undefined,
  citations: readonly Pick<ChatCitation, 'label'>[] = [],
): string | undefined {
  if (!p) return undefined;
  if (p.kind === 'grounded')
    return citations.length ? `Sources: ${citations.map((c) => `[${c.label}]`).join(' ')}` : p.label;
  return p.label;
}
