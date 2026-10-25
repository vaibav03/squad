import type { Db, SourceKind } from '@squad/core';
import { sourceUri } from '@squad/core';
import { tokenize } from '../dean/bm25';
import { chunkIdFor } from './ids';
import {
  DEFAULT_RETENTION_MS,
  type ChunkHit,
  type ContextChunk,
  type ContextConnection,
  type ContextSource,
  type ContextViewer,
  type ConnectionStatus,
  type ContextSyncState,
} from './types';
import type { TextPiece } from './chunk';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ctx_connections(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, provider TEXT NOT NULL, mode TEXT NOT NULL, variant TEXT NOT NULL,
  account_hash TEXT NOT NULL, scopes_json TEXT NOT NULL, status TEXT NOT NULL, degraded INTEGER NOT NULL DEFAULT 0,
  status_note TEXT, created_at INTEGER NOT NULL, last_sync_at INTEGER, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS ctx_connections_owner ON ctx_connections(owner_id);
CREATE TABLE IF NOT EXISTS ctx_sources(
  id TEXT PRIMARY KEY, connection_id TEXT, owner_id TEXT NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL,
  uri TEXT NOT NULL, url TEXT, title TEXT NOT NULL, course_id TEXT, modified_at INTEGER, due_at INTEGER,
  starts_at INTEGER, ends_at INTEGER, content_hash TEXT NOT NULL, fetched_at INTEGER NOT NULL, expires_at INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private', provenance TEXT NOT NULL, sync_version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ctx_sources_conn ON ctx_sources(connection_id);
CREATE INDEX IF NOT EXISTS ctx_sources_owner ON ctx_sources(owner_id, content_hash);
CREATE TABLE IF NOT EXISTS ctx_shares(source_id TEXT NOT NULL, squad_id TEXT NOT NULL, PRIMARY KEY(source_id, squad_id));
CREATE TABLE IF NOT EXISTS ctx_chunks(
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, ord INTEGER NOT NULL, anchor TEXT NOT NULL, page INTEGER,
  section TEXT, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ctx_chunks_source ON ctx_chunks(source_id);
CREATE TABLE IF NOT EXISTS ctx_sync_state(
  connection_id TEXT PRIMARY KEY, cursor_json TEXT, last_full_at INTEGER, last_outcome TEXT, retry_after INTEGER,
  started_at INTEGER, origin_hash TEXT);
CREATE INDEX IF NOT EXISTS ctx_connections_account ON ctx_connections(provider, account_hash);
CREATE TABLE IF NOT EXISTS ctx_courses(
  connection_id TEXT NOT NULL, course_id TEXT NOT NULL, code TEXT, name TEXT NOT NULL, PRIMARY KEY(connection_id, course_id));
CREATE TABLE IF NOT EXISTS ctx_tombstones(
  source_id TEXT NOT NULL, owner_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY(source_id, owner_id));
`;

export type UpsertOutcome = 'added' | 'updated' | 'unchanged' | 'duplicate';

export type SourceInput = Omit<ContextSource, 'visibility' | 'sharedWith' | 'syncVersion' | 'uri'> &
  Partial<Pick<ContextSource, 'visibility' | 'sharedWith' | 'syncVersion'>>;

export interface PurgeResult {
  sources: number;
  chunks: number;
}

export interface ContextStore {
  upsertConnection(c: ContextConnection): void;
  /** Course records (code + name) of a connection, so every source of that course resolves courseName / courseCode. */
  setCourses(connectionId: string, courses: { id: string; name: string; code?: string | null }[]): void;
  course(connectionId: string | null, courseId: string | null): { name: string; code: string | null } | undefined;
  connection(id: string): ContextConnection | undefined;
  connectionsOf(ownerId: string): ContextConnection[];
  /** Every owner's non-revoked connection to the same external account (for the one-owner-per-account rule). */
  connectionsByAccount(
    provider: ContextConnection['provider'],
    accountHash: string,
  ): ContextConnection[];
  syncState(connectionId: string): ContextSyncState;
  patchSyncState(
    connectionId: string,
    patch: Partial<Omit<ContextSyncState, 'connectionId'>>,
  ): void;
  patchConnection(
    id: string,
    patch: Partial<
      Pick<ContextConnection, 'status' | 'degraded' | 'statusNote' | 'lastSyncAt' | 'expiresAt'>
    >,
  ): void;
  /** Delete every derived row for the connection (sources, chunks, shares), leave tombstones, mark revoked. */
  revokeConnection(
    id: string,
    reason: 'revoked' | 'removed',
    at: number,
    note?: string,
  ): PurgeResult;
  /** Delete the connection row itself (after a purge). */
  deleteConnection(id: string): void;

  upsertSource(s: SourceInput, pieces: TextPiece[]): UpsertOutcome;
  deleteSource(id: string, reason: 'revoked' | 'removed', at: number): void;
  source(id: string): ContextSource | undefined;
  sourcesOfConnection(connectionId: string): ContextSource[];
  chunks(sourceId: string): ContextChunk[];
  chunk(sourceId: string, anchor?: string): ContextChunk | undefined;
  tombstone(sourceId: string): { ownerId: string; reason: 'revoked' | 'removed' } | undefined;

  share(sourceId: string, squadId: string): void;
  unshare(sourceId: string, squadId: string): void;
  canRead(s: ContextSource, v: ContextViewer): boolean;
  /** The source if (and only if) the viewer may read it; undefined otherwise (indistinguishable from missing). */
  readable(sourceId: string, v: ContextViewer): ContextSource | undefined;
  search(
    query: string,
    v: ContextViewer,
    opts?: { courseId?: string; limit?: number; kinds?: SourceKind[] },
  ): ChunkHit[];
  /** How many sources the viewer may read (own plus squad-shared); 0 means nothing is connected for them. */
  readableCount(v: ContextViewer): number;
  /** Purge sources whose retention has elapsed. */
  purgeExpired(now: number): PurgeResult;
  setStatus(id: string, status: ConnectionStatus, note: string | null, degraded?: boolean): void;
}

interface SrcRow {
  id: string;
  connection_id: string | null;
  owner_id: string;
  kind: SourceKind;
  external_id: string;
  uri: string;
  url: string | null;
  title: string;
  course_id: string | null;
  modified_at: number | null;
  due_at: number | null;
  starts_at: number | null;
  ends_at: number | null;
  content_hash: string;
  fetched_at: number;
  expires_at: number | null;
  visibility: 'private' | 'squad';
  provenance: string;
  sync_version: number;
}
interface ConnRow {
  id: string;
  owner_id: string;
  provider: 'canvas' | 'google';
  mode: 'fixture' | 'live';
  variant: string;
  account_hash: string;
  scopes_json: string;
  status: ConnectionStatus;
  degraded: number;
  status_note: string | null;
  created_at: number;
  last_sync_at: number | null;
  expires_at: number | null;
}

export function createContextStore(db: Db, opts: { retentionMs?: number } = {}): ContextStore {
  db.exec(SCHEMA);
  const retention = opts.retentionMs ?? DEFAULT_RETENTION_MS;

  const shares = (id: string): string[] =>
    (
      db.prepare('SELECT squad_id FROM ctx_shares WHERE source_id=? ORDER BY squad_id').all(id) as {
        squad_id: string;
      }[]
    ).map((r) => r.squad_id);
  const courseRow = db.prepare('SELECT code, name FROM ctx_courses WHERE connection_id=? AND course_id=?');
  const toSource = (r: SrcRow): ContextSource => {
    const cr =
      r.connection_id && r.course_id
        ? (courseRow.get(r.connection_id, r.course_id) as { code: string | null; name: string } | undefined)
        : undefined;
    return {
      ...toSourceBase(r),
      ...(cr ? { courseName: cr.name, courseCode: cr.code } : {}),
    };
  };
  const toSourceBase = (r: SrcRow): ContextSource => ({
    id: r.id,
    connectionId: r.connection_id,
    ownerId: r.owner_id,
    kind: r.kind,
    externalId: r.external_id,
    uri: r.uri,
    url: r.url,
    title: r.title,
    courseId: r.course_id,
    modifiedAt: r.modified_at,
    dueAt: r.due_at,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    contentHash: r.content_hash,
    fetchedAt: r.fetched_at,
    expiresAt: r.expires_at,
    visibility: r.visibility,
    sharedWith: shares(r.id),
    provenance: r.provenance,
    syncVersion: r.sync_version,
  });
  const toConn = (r: ConnRow): ContextConnection => ({
    id: r.id,
    ownerId: r.owner_id,
    provider: r.provider,
    mode: r.mode,
    variant: r.variant,
    accountHash: r.account_hash,
    scopes: JSON.parse(r.scopes_json) as string[],
    status: r.status,
    degraded: r.degraded === 1,
    statusNote: r.status_note,
    createdAt: r.created_at,
    lastSyncAt: r.last_sync_at,
    expiresAt: r.expires_at,
  });

  const delChunks = db.prepare('DELETE FROM ctx_chunks WHERE source_id=?');
  const delShares = db.prepare('DELETE FROM ctx_shares WHERE source_id=?');
  const delSource = db.prepare('DELETE FROM ctx_sources WHERE id=?');
  const tomb = db.prepare(
    'INSERT OR REPLACE INTO ctx_tombstones(source_id, owner_id, reason, at) VALUES(?,?,?,?)',
  );
  const countChunks = db.prepare('SELECT COUNT(*) AS n FROM ctx_chunks WHERE source_id=?');

  function removeSource(
    s: { id: string; owner_id: string },
    reason: 'revoked' | 'removed',
    at: number,
  ): number {
    const n = (countChunks.get(s.id) as { n: number }).n;
    delChunks.run(s.id);
    delShares.run(s.id);
    delSource.run(s.id);
    tomb.run(s.id, s.owner_id, reason, at);
    return n;
  }

  const store: ContextStore = {
    setCourses(connectionId, courses) {
      const ins = db.prepare('INSERT OR REPLACE INTO ctx_courses VALUES(?,?,?,?)');
      for (const c of courses) if (c.id && c.name) ins.run(connectionId, c.id, c.code ?? null, c.name.slice(0, 300));
    },
    course(connectionId, courseId) {
      if (!connectionId || !courseId) return undefined;
      return courseRow.get(connectionId, courseId) as { name: string; code: string | null } | undefined;
    },
    upsertConnection(c) {
      db.prepare(
        `INSERT OR REPLACE INTO ctx_connections(id, owner_id, provider, mode, variant, account_hash, scopes_json, status,
          degraded, status_note, created_at, last_sync_at, expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        c.id,
        c.ownerId,
        c.provider,
        c.mode,
        c.variant,
        c.accountHash,
        JSON.stringify(c.scopes),
        c.status,
        c.degraded ? 1 : 0,
        c.statusNote,
        c.createdAt,
        c.lastSyncAt,
        c.expiresAt,
      );
    },
    connection(id) {
      const r = db.prepare('SELECT * FROM ctx_connections WHERE id=?').get(id) as
        ConnRow | undefined;
      return r ? toConn(r) : undefined;
    },
    connectionsOf(ownerId) {
      return (
        db
          .prepare('SELECT * FROM ctx_connections WHERE owner_id=? ORDER BY created_at, id')
          .all(ownerId) as ConnRow[]
      ).map(toConn);
    },
    connectionsByAccount(provider, accountHash) {
      return (
        db
          .prepare(
            "SELECT * FROM ctx_connections WHERE provider=? AND account_hash=? AND status<>'revoked' ORDER BY created_at, id",
          )
          .all(provider, accountHash) as ConnRow[]
      ).map(toConn);
    },
    syncState(connectionId) {
      const r = db
        .prepare('SELECT * FROM ctx_sync_state WHERE connection_id=?')
        .get(connectionId) as
        | {
            cursor_json: string | null;
            last_full_at: number | null;
            last_outcome: ContextSyncState['lastOutcome'];
            retry_after: number | null;
            started_at: number | null;
            origin_hash: string | null;
          }
        | undefined;
      return {
        connectionId,
        cursor: r?.cursor_json ? (JSON.parse(r.cursor_json) as ContextSyncState['cursor']) : null,
        lastFullAt: r?.last_full_at ?? null,
        lastOutcome: r?.last_outcome ?? null,
        retryAfter: r?.retry_after ?? null,
        startedAt: r?.started_at ?? null,
        originHash: r?.origin_hash ?? null,
      };
    },
    patchSyncState(connectionId, p) {
      const n = { ...store.syncState(connectionId), ...p };
      db.prepare(
        `INSERT OR REPLACE INTO ctx_sync_state(connection_id, cursor_json, last_full_at, last_outcome, retry_after, started_at, origin_hash)
         VALUES(?,?,?,?,?,?,?)`,
      ).run(
        connectionId,
        n.cursor ? JSON.stringify(n.cursor) : null,
        n.lastFullAt,
        n.lastOutcome,
        n.retryAfter,
        n.startedAt,
        n.originHash,
      );
    },
    patchConnection(id, p) {
      const cur = store.connection(id);
      if (!cur) return;
      store.upsertConnection({ ...cur, ...p });
    },
    setStatus(id, status, note, degraded = false) {
      store.patchConnection(id, { status, statusNote: note, degraded });
    },
    revokeConnection(id, reason, at, note) {
      const rows = db
        .prepare('SELECT id, owner_id FROM ctx_sources WHERE connection_id=?')
        .all(id) as {
        id: string;
        owner_id: string;
      }[];
      let chunks = 0;
      db.transaction(() => {
        for (const r of rows) chunks += removeSource(r, reason, at);
      })();
      store.patchConnection(id, {
        status: 'revoked',
        degraded: false,
        statusNote: note ?? 'Disconnected. All imported data was deleted.',
        expiresAt: null,
      });
      db.prepare('DELETE FROM ctx_courses WHERE connection_id=?').run(id);
      store.patchSyncState(id, {
        cursor: null,
        lastFullAt: null,
        lastOutcome: 'revoked',
        retryAfter: null,
        startedAt: null,
        originHash: null,
      });
      return { sources: rows.length, chunks };
    },
    deleteConnection(id) {
      db.prepare('DELETE FROM ctx_sync_state WHERE connection_id=?').run(id);
      db.prepare('DELETE FROM ctx_courses WHERE connection_id=?').run(id);
      db.prepare('DELETE FROM ctx_connections WHERE id=?').run(id);
    },

    upsertSource(s, pieces) {
      const existing = db.prepare('SELECT * FROM ctx_sources WHERE id=?').get(s.id) as
        SrcRow | undefined;
      if (existing && existing.content_hash === s.contentHash) {
        // Same content: only refresh metadata that can change without new text (title, dates, fetch time).
        db.prepare(
          'UPDATE ctx_sources SET title=?, due_at=?, starts_at=?, ends_at=?, modified_at=?, fetched_at=?, expires_at=? WHERE id=?',
        ).run(
          s.title,
          s.dueAt,
          s.startsAt,
          s.endsAt,
          s.modifiedAt,
          s.fetchedAt,
          s.expiresAt ?? s.fetchedAt + retention,
          s.id,
        );
        return 'unchanged';
      }
      if (!existing) {
        const dup = db
          .prepare(
            'SELECT id FROM ctx_sources WHERE owner_id=? AND content_hash=? AND id<>? LIMIT 1',
          )
          .get(s.ownerId, s.contentHash, s.id);
        if (dup) return 'duplicate';
      }
      const uri = sourceUri({ kind: s.kind, id: s.id });
      db.transaction(() => {
        db.prepare(
          `INSERT OR REPLACE INTO ctx_sources(id, connection_id, owner_id, kind, external_id, uri, url, title, course_id,
            modified_at, due_at, starts_at, ends_at, content_hash, fetched_at, expires_at, visibility, provenance, sync_version)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          s.id,
          s.connectionId,
          s.ownerId,
          s.kind,
          s.externalId,
          uri,
          s.url,
          s.title,
          s.courseId,
          s.modifiedAt,
          s.dueAt,
          s.startsAt,
          s.endsAt,
          s.contentHash,
          s.fetchedAt,
          s.expiresAt ?? s.fetchedAt + retention,
          existing?.visibility ?? s.visibility ?? 'private',
          s.provenance,
          (existing?.sync_version ?? 0) + 1,
        );
        delChunks.run(s.id);
        const ins = db.prepare(
          'INSERT INTO ctx_chunks(id, source_id, ord, anchor, page, section, text) VALUES(?,?,?,?,?,?,?)',
        );
        pieces.forEach((p, i) =>
          ins.run(chunkIdFor(s.id, p.anchor), s.id, i, p.anchor, p.page, p.section, p.text),
        );
        db.prepare('DELETE FROM ctx_tombstones WHERE source_id=?').run(s.id);
      })();
      return existing ? 'updated' : 'added';
    },
    deleteSource(id, reason, at) {
      const r = db.prepare('SELECT id, owner_id FROM ctx_sources WHERE id=?').get(id) as
        { id: string; owner_id: string } | undefined;
      if (r) removeSource(r, reason, at);
    },
    source(id) {
      const r = db.prepare('SELECT * FROM ctx_sources WHERE id=?').get(id) as SrcRow | undefined;
      return r ? toSource(r) : undefined;
    },
    sourcesOfConnection(connectionId) {
      return (
        db
          .prepare('SELECT * FROM ctx_sources WHERE connection_id=? ORDER BY id')
          .all(connectionId) as SrcRow[]
      ).map(toSource);
    },
    chunks(sourceId) {
      return (
        db.prepare('SELECT * FROM ctx_chunks WHERE source_id=? ORDER BY ord').all(sourceId) as {
          id: string;
          source_id: string;
          ord: number;
          anchor: string;
          page: number | null;
          section: string | null;
          text: string;
        }[]
      ).map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        ord: r.ord,
        anchor: r.anchor,
        page: r.page,
        section: r.section,
        text: r.text,
      }));
    },
    chunk(sourceId, anchor) {
      const all = store.chunks(sourceId);
      return anchor ? all.find((c) => c.anchor === anchor) : all[0];
    },
    tombstone(sourceId) {
      const r = db
        .prepare('SELECT owner_id, reason FROM ctx_tombstones WHERE source_id=?')
        .get(sourceId) as { owner_id: string; reason: 'revoked' | 'removed' } | undefined;
      return r ? { ownerId: r.owner_id, reason: r.reason } : undefined;
    },

    share(sourceId, squadId) {
      if (!store.source(sourceId)) return;
      db.prepare('INSERT OR IGNORE INTO ctx_shares(source_id, squad_id) VALUES(?,?)').run(
        sourceId,
        squadId,
      );
      db.prepare("UPDATE ctx_sources SET visibility='squad' WHERE id=?").run(sourceId);
    },
    unshare(sourceId, squadId) {
      db.prepare('DELETE FROM ctx_shares WHERE source_id=? AND squad_id=?').run(sourceId, squadId);
      if (shares(sourceId).length === 0)
        db.prepare("UPDATE ctx_sources SET visibility='private' WHERE id=?").run(sourceId);
    },
    canRead(s, v) {
      if (s.ownerId === v.studentId) return true;
      return s.visibility === 'squad' && s.sharedWith.some((q) => v.squadIds.includes(q));
    },
    readable(sourceId, v) {
      const s = store.source(sourceId);
      return s && store.canRead(s, v) ? s : undefined;
    },
    readableCount(v) {
      const marks = v.squadIds.map(() => '?').join(',');
      const row = db
        .prepare(
          `SELECT COUNT(*) n FROM ctx_sources s WHERE s.owner_id=? ${
            v.squadIds.length
              ? `OR (s.visibility='squad' AND EXISTS(SELECT 1 FROM ctx_shares h WHERE h.source_id=s.id AND h.squad_id IN (${marks})))`
              : ''
          }`,
        )
        .get(v.studentId, ...v.squadIds) as { n: number };
      return row.n;
    },
    search(query, v, o = {}) {
      const q = [...new Set(tokenize(query))];
      if (q.length === 0) return [];
      const kinds = o.kinds ? new Set(o.kinds) : null;
      // Visibility is decided in SQL first so unreadable text is never even loaded.
      const squadMarks = v.squadIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT c.id AS cid FROM ctx_chunks c JOIN ctx_sources s ON s.id=c.source_id
           WHERE (s.owner_id=? ${v.squadIds.length ? `OR (s.visibility='squad' AND EXISTS(SELECT 1 FROM ctx_shares h WHERE h.source_id=s.id AND h.squad_id IN (${squadMarks})))` : ''})
           ${o.courseId ? 'AND s.course_id=?' : ''}`,
        )
        .all(v.studentId, ...v.squadIds, ...(o.courseId ? [o.courseId] : [])) as { cid: string }[];
      const docs: { chunk: ContextChunk; source: ContextSource; toks: string[] }[] = [];
      const srcCache = new Map<string, ContextSource | undefined>();
      const chunkStmt = db.prepare('SELECT * FROM ctx_chunks WHERE id=?');
      for (const { cid } of rows) {
        const r = chunkStmt.get(cid) as {
          id: string;
          source_id: string;
          ord: number;
          anchor: string;
          page: number | null;
          section: string | null;
          text: string;
        };
        if (!srcCache.has(r.source_id)) srcCache.set(r.source_id, store.source(r.source_id));
        const source = srcCache.get(r.source_id);
        if (!source || !store.canRead(source, v)) continue;
        if (kinds && !kinds.has(source.kind)) continue;
        const chunk = {
          id: r.id,
          sourceId: r.source_id,
          ord: r.ord,
          anchor: r.anchor,
          page: r.page,
          section: r.section,
          text: r.text,
        };
        // Title is searchable too: "assignment 3" should find the Assignment 3 chunks.
        docs.push({
          chunk,
          source,
          toks: tokenize(`${source.title} ${r.section ?? ''} ${r.text}`),
        });
      }
      if (docs.length === 0) return [];
      const avg = docs.reduce((n, d) => n + d.toks.length, 0) / docs.length || 1;
      const df = new Map<string, number>();
      for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) ?? 0) + 1);
      const k1 = 1.5;
      const b = 0.75;
      const hits: ChunkHit[] = [];
      for (const d of docs) {
        const tf = new Map<string, number>();
        for (const t of d.toks) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const t of q) {
          const f = tf.get(t);
          if (!f) continue;
          const n = df.get(t) ?? 0;
          score +=
            (Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) * f * (k1 + 1)) /
            (f + k1 * (1 - b + (b * d.toks.length) / avg));
        }
        if (score > 0) hits.push({ chunk: d.chunk, source: d.source, score });
      }
      return hits
        .sort((a, c) => c.score - a.score || a.chunk.id.localeCompare(c.chunk.id))
        .slice(0, o.limit ?? 5);
    },
    purgeExpired(now) {
      const rows = db
        .prepare(
          'SELECT id, owner_id FROM ctx_sources WHERE expires_at IS NOT NULL AND expires_at<=?',
        )
        .all(now) as {
        id: string;
        owner_id: string;
      }[];
      let chunks = 0;
      db.transaction(() => {
        for (const r of rows) chunks += removeSource(r, 'removed', now);
      })();
      return { sources: rows.length, chunks };
    },
  };
  return store;
}
