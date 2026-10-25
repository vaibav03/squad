import type { SourceKind } from '@squad/core';

export type Provider = 'canvas' | 'google';
/** `fixture` = synthetic repo data; no real account is connected. The UI must say so. */
export type ConnectionMode = 'fixture' | 'live';
export type ConnectionStatus = 'live' | 'expired' | 'revoked' | 'error' | 'rate_limited';
/** The one state every UI and API shows (Nook-style honest states). `fixture` = live status on synthetic data. */
export type ConnectionState = 'live' | 'fixture' | 'expired' | 'revoked' | 'rate_limited' | 'error';

export const connectionState = (c: Pick<ContextConnection, 'mode' | 'status'>): ConnectionState =>
  c.status === 'live' ? (c.mode === 'fixture' ? 'fixture' : 'live') : c.status;

/** Incremental sync position. `updatedAt` is the upstream high-water mark; the window bounds the backfill. */
export interface SyncCursor {
  updatedAt: number | null;
  windowFrom: number;
  windowTo: number;
}
export type SyncOutcomeLabel = 'ok' | 'expired' | 'revoked' | 'rate_limited' | 'degraded' | 'error';
export interface ContextSyncState {
  connectionId: string;
  cursor: SyncCursor | null;
  /** Last time every upstream item was listed (deletions are only detected on a full pass). */
  lastFullAt: number | null;
  lastOutcome: SyncOutcomeLabel | null;
  /** Epoch ms: no upstream call before this (rate limit). */
  retryAfter: number | null;
  /** Epoch ms while a sync is running (cleared when it ends). */
  startedAt: number | null;
  /** Hash of the Canvas origin (session variant), for the one-login-per-origin rule. Never the raw origin. */
  originHash: string | null;
}

export const BACKFILL_PAST_MS = 120 * 24 * 3_600_000;
export const BACKFILL_FUTURE_MS = 180 * 24 * 3_600_000;
export const FULL_PASS_EVERY_MS = 24 * 3_600_000;
export type ContextVisibility = 'private' | 'squad';

export interface ContextConnection {
  id: string;
  ownerId: string;
  provider: Provider;
  mode: ConnectionMode;
  /** Variant of the provider auth: canvas `session` (browser extension) | `token` | `feed`; google `oauth`. */
  variant: string;
  /** Salted hash of the external account id; the raw id is never stored. */
  accountHash: string;
  scopes: string[];
  status: ConnectionStatus;
  /** True when the upstream answered 401/403 but the token has not (yet) expired by the clock. */
  degraded: boolean;
  statusNote: string | null;
  createdAt: number;
  lastSyncAt: number | null;
  /** When the credential stops working (null: no known expiry, e.g. a Canvas feed URL). */
  expiresAt: number | null;
}

export interface ContextSource {
  /** Stable: derived from (provider, externalId, owner), identical across re-syncs. */
  id: string;
  connectionId: string | null;
  ownerId: string;
  kind: SourceKind;
  externalId: string;
  /** `source://<kind>/<id>` */
  uri: string;
  /** Deep link into Canvas/Drive/Calendar, or null (uploaded PDFs). */
  url: string | null;
  title: string;
  courseId: string | null;
  /** Resolved from the connection's course records (absent when unknown). */
  courseName?: string;
  courseCode?: string | null;
  /** Origin timestamps, epoch ms. */
  modifiedAt: number | null;
  dueAt: number | null;
  startsAt: number | null;
  endsAt: number | null;
  contentHash: string;
  fetchedAt: number;
  /** Derived-data retention: the source and its chunks are purged at this time. */
  expiresAt: number | null;
  visibility: ContextVisibility;
  /** Squads this source is explicitly shared with (empty while private). */
  sharedWith: string[];
  /** Where it came from, e.g. `canvas:fixture`. */
  provenance: string;
  syncVersion: number;
}

export interface ContextChunk {
  id: string;
  sourceId: string;
  ord: number;
  /** Stable anchor inside the source: `p3` (page), `s2` (section), `c1` (chunk). */
  anchor: string;
  page: number | null;
  section: string | null;
  text: string;
}

export interface ContextViewer {
  studentId: string;
  /** Squads the viewer is a verified member of (the caller checks membership). */
  squadIds: string[];
}

export interface ChunkHit {
  chunk: ContextChunk;
  source: ContextSource;
  score: number;
}

export const DEFAULT_RETENTION_MS = 180 * 24 * 3_600_000;

/** "CODE: Name" for a source or course record ("HIST 140: Modern World History"); the best available words otherwise. */
export function courseLabel(c: {
  courseName?: string | null | undefined;
  courseCode?: string | null | undefined;
  courseId?: string | null | undefined;
}): string | null {
  const name = c.courseName?.trim();
  const code = c.courseCode?.trim();
  if (code && name && name.toLowerCase() !== code.toLowerCase()) return `${code}: ${name}`;
  return name || code || c.courseId || null;
}
