import type { SourceKind } from '@squad/core';

export type Provider = 'canvas' | 'google';
/** `fixture` = synthetic repo data; no real account is connected. The UI must say so. */
export type ConnectionMode = 'fixture' | 'live';
export type ConnectionStatus = 'live' | 'expired' | 'revoked' | 'error';
export type ContextVisibility = 'private' | 'squad';

export interface ContextConnection {
  id: string;
  ownerId: string;
  provider: Provider;
  mode: ConnectionMode;
  /** Variant of the provider auth: canvas `feed` | `token`; google `oauth`. */
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
