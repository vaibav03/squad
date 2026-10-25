import { z } from 'zod';

/** Every kind of source a citation can point at. `pdf` is the original uploaded course material. */
export const SOURCE_KINDS = [
  'pdf',
  'canvas_file',
  'canvas_assignment',
  'canvas_event',
  'gdoc',
  'gdrive_file',
  'gcal_event',
  'classroom_item',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SourceKindSchema = z.enum(SOURCE_KINDS);

/** `source://<kind>/<id>#<anchor>` (anchor optional): the generalised citation target. */
export const CitationSourceSchema = z.strictObject({
  kind: SourceKindSchema,
  id: z.string().min(1).max(200),
  anchor: z.string().max(100).optional(),
  title: z.string().max(300).optional(),
  /** Deep link into the origin system (Canvas, Drive, Calendar), when one exists. */
  url: z.string().max(2000).optional(),
  /** `fixture` = simulated data, not the person's account; `real` = imported from their own account. Absent: unknown. */
  provenance: z.enum(['real', 'fixture']).optional(),
  /** Course / event the item belongs to, shown on the chip. */
  courseName: z.string().max(300).optional(),
  /** Page or item location inside the source (`Due Fri 12 Oct`, `p.3`, `section 2`). */
  locationLabel: z.string().max(200).optional(),
  /** `related`: shown only as background, the source is NOT about what was asked (chip reads `Related, not about this`). */
  relation: z.literal('related').optional(),
});
export type CitationSource = z.infer<typeof CitationSourceSchema>;

export const sourceUri = (s: {
  kind: SourceKind;
  id: string;
  anchor?: string | undefined;
}): string =>
  `source://${s.kind}/${encodeURIComponent(s.id)}${s.anchor ? `#${encodeURIComponent(s.anchor)}` : ''}`;

/** Inverse of `sourceUri`; null when the string is not a well-formed source URI. */
export function parseSourceUri(
  uri: string,
): { kind: SourceKind; id: string; anchor?: string } | null {
  const m = /^source:\/\/([a-z_]+)\/([^#\s]+)(?:#(\S+))?$/.exec(uri.trim());
  if (!m) return null;
  const kind = SourceKindSchema.safeParse(m[1]);
  if (!kind.success) return null;
  try {
    const id = decodeURIComponent(m[2]!);
    const anchor = m[3] ? decodeURIComponent(m[3]) : undefined;
    return { kind: kind.data, id, ...(anchor ? { anchor } : {}) };
  } catch {
    return null;
  }
}
