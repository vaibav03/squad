// "Ask Cubbie": turns a source id the client names into a VERIFIED ChatContextRef. The client's own title, course,
// provenance, etc. are never trusted: everything is re-read from the store through the viewer's read gate.
import type { ChatContextRef } from '@squad/core';
import type { ContextSource, ContextStore, ContextViewer } from '@squad/brain';

const CALENDAR = new Set(['gcal_event', 'canvas_event']);
export const PRIVATE_EVENT_TITLE = 'Private calendar event';

const fmt = (ms: number, withTime: boolean): string =>
  new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    timeZone: 'UTC',
  }) + (withTime ? ' UTC' : '');

export type ContextRefResult =
  | { ok: true; ref: ChatContextRef; source: ContextSource }
  | { ok: false; code: 'not_found' | 'page_missing' };

export function buildContextRef(
  store: ContextStore,
  viewer: ContextViewer,
  sourceId: string,
  anchor?: string,
): ContextRefResult {
  // the read gate: another member's private source answers exactly like a missing one
  const src = store.readable(sourceId, viewer);
  if (!src) return { ok: false, code: 'not_found' };
  const chunks = store.chunks(src.id);
  const chunk = anchor ? store.chunk(src.id, anchor) : chunks[0];
  if (anchor && !chunk) return { ok: false, code: 'page_missing' };
  const courseLine = /^Course:\s*(.+)$/m.exec(chunks[0]?.text ?? '')?.[1]?.trim();
  const eventLabel =
    src.startsAt !== null
      ? fmt(src.startsAt, true)
      : src.dueAt !== null
        ? `Due ${fmt(src.dueAt, false)}`
        : null;
  const locLabel = chunk?.section || (chunk ? `item ${chunk.anchor}` : undefined);
  const ref: ChatContextRef = {
    sourceId: src.id,
    kind: src.kind,
    title: src.title,
    courseId: src.courseId,
    ...(courseLine ? { courseName: courseLine } : {}),
    eventLabel,
    location: { ...(chunk ? { anchor: chunk.anchor } : {}), ...(locLabel ? { label: locLabel } : {}) },
    provenance: src.provenance.endsWith(':fixture') ? 'fixture' : 'real',
    provider: src.provenance.split(':')[0] ?? 'unknown',
    fetchedAt: src.fetchedAt,
    shared: src.sharedWith.length > 0,
  };
  return { ok: true, ref, source: src };
}

/**
 * What may be STORED on the (group-visible) chat message and shown to the squad. A calendar event that is not shared
 * never shows its title, time or location to anyone but its owner's DM.
 */
export function publicView(ref: ChatContextRef, group: boolean): ChatContextRef {
  if (!group || !CALENDAR.has(ref.kind) || ref.shared) return ref;
  return {
    sourceId: ref.sourceId,
    kind: ref.kind,
    title: PRIVATE_EVENT_TITLE,
    courseId: null,
    eventLabel: null,
    provenance: ref.provenance,
    provider: ref.provider,
    shared: false,
  };
}
