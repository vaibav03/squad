import { sourceUri, type SourceKind } from '@squad/core';
import { chunkPages, chunkText, type TextPiece } from './chunk';
import type { ConnectorItem, FetchedContent } from './connectors/types';
import { contentHash, sourceIdFor } from './ids';
import type { SourceInput } from './store';
import type { ConnectionMode, Provider } from './types';

/** Kinds where the same bytes may arrive via two routes (Canvas + Drive + upload) and should be stored once. */
const FILE_LIKE: ReadonlySet<SourceKind> = new Set(['pdf', 'canvas_file', 'gdoc', 'gdrive_file']);

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

export interface NormalizeCtx {
  ownerId: string;
  connectionId: string;
  provider: Provider;
  mode: ConnectionMode;
  now: number;
  retentionMs?: number;
}

/** Turns one upstream item plus its fetched content into a stored-source record and its anchored chunks. */
export function normalizeItem(
  ctx: NormalizeCtx,
  item: ConnectorItem,
  content: FetchedContent,
): { source: SourceInput; pieces: TextPiece[] } {
  let text: string;
  let pieces: TextPiece[];
  if (content.pages?.length) {
    pieces = chunkPages(content.pages);
    text = content.pages.map((p) => p.text).join('\n\n');
  } else {
    const head: string[] = [`# ${item.title}`];
    if (item.dueAt) head.push(`Due: ${iso(item.dueAt)}`);
    if (item.startsAt) head.push(`Starts: ${iso(item.startsAt)}`);
    if (item.endsAt && item.endsAt !== item.startsAt) head.push(`Ends: ${iso(item.endsAt)}`);
    const meta = head.slice(1).join('\n');
    const body = (content.text ?? '').trim();
    text = [meta, body].filter(Boolean).join('\n\n');
    // The title is the section heading of every chunk; the dates and body follow as paragraphs.
    pieces = chunkText(`${head[0]}\n\n${text}`, { prefix: 's' });
  }
  const id = sourceIdFor(ctx.ownerId, ctx.provider, item.externalId);
  const hashInput = FILE_LIKE.has(item.kind)
    ? text
    : `${item.kind}\u0000${item.externalId}\u0000${item.title}\u0000${text}`;
  const source: SourceInput = {
    id,
    connectionId: ctx.connectionId,
    ownerId: ctx.ownerId,
    kind: item.kind,
    externalId: item.externalId,
    url: item.url,
    title: item.title,
    courseId: item.courseId,
    modifiedAt: item.modifiedAt,
    dueAt: item.dueAt ?? null,
    startsAt: item.startsAt ?? null,
    endsAt: item.endsAt ?? null,
    contentHash: contentHash(hashInput),
    fetchedAt: ctx.now,
    expiresAt: ctx.retentionMs ? ctx.now + ctx.retentionMs : null,
    provenance: `${ctx.provider}:${ctx.mode}`,
  };
  return { source, pieces };
}

export { sourceUri };
