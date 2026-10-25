import type { Connector } from './connectors/types';
import {
  ConnectorAuthError,
  ConnectorExpiredError,
  ConnectorRateLimitError,
  type ListOpts,
} from './connectors/types';
import { normalizeItem } from './normalize';
import type { ContextStore } from './store';
import {
  BACKFILL_FUTURE_MS,
  BACKFILL_PAST_MS,
  FULL_PASS_EVERY_MS,
  type ContextConnection,
  type SyncOutcomeLabel,
} from './types';

export interface SyncReport {
  outcome: 'ok' | 'skipped' | 'expired' | 'revoked' | 'degraded' | 'rate_limited' | 'error';
  /** `backfill` lists the whole window (first pass, or the daily full pass); `incremental` lists changes only. */
  pass?: 'backfill' | 'incremental';
  /** Epoch ms before which no further upstream call will be made (rate_limited). */
  retryAfter?: number;
  added: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  removed: number;
  failed: number;
  note?: string;
}

const empty = (outcome: SyncReport['outcome'], note?: string): SyncReport => ({
  outcome,
  added: 0,
  updated: 0,
  unchanged: 0,
  duplicates: 0,
  removed: 0,
  failed: 0,
  ...(note ? { note } : {}),
});

export interface SyncDeps {
  store: ContextStore;
  now: () => number;
  retentionMs?: number;
  /** Force a full (backfill) pass: manual "resync everything" and tests. */
  full?: boolean;
}

/**
 * One sync pass: probe status, list (backfill window on the first and daily full passes, otherwise only changes
 * since the cursor), fetch, normalise (chunk + hash), dedupe, index. Expired connections never call upstream; a
 * rate-limited one waits out `retryAfter`; a revoked grant purges everything; a 401 marks the connection degraded and
 * keeps what was already imported. Deletions are only detected on full passes. Never throws on upstream failure.
 */
export async function syncConnection<A>(
  deps: SyncDeps,
  connection: ContextConnection,
  connector: Connector<A>,
  auth: A,
): Promise<SyncReport> {
  const { store, now } = deps;
  const conn = store.connection(connection.id);
  if (!conn) return empty('skipped', 'unknown connection');
  const done = (r: SyncReport, label: SyncOutcomeLabel): SyncReport => {
    store.patchSyncState(conn.id, { lastOutcome: label, startedAt: null });
    return r;
  };
  if (conn.status === 'revoked') return empty('revoked', 'connection was revoked');
  if (conn.status === 'expired')
    return empty('expired', 'credential expired; reconnect to resume syncing');
  if (conn.expiresAt !== null && conn.expiresAt <= now()) {
    store.setStatus(conn.id, 'expired', 'The credential expired. Reconnect to resume syncing.');
    return done(empty('expired', 'credential expired'), 'expired');
  }
  const prior = store.syncState(conn.id);
  if (prior.retryAfter !== null && prior.retryAfter > now()) {
    return {
      ...empty('rate_limited', 'waiting out the provider rate limit'),
      retryAfter: prior.retryAfter,
    };
  }
  store.patchSyncState(conn.id, { startedAt: now(), retryAfter: null });
  const full =
    deps.full === true ||
    prior.cursor === null ||
    prior.lastFullAt === null ||
    now() - prior.lastFullAt >= FULL_PASS_EVERY_MS;
  const opts: ListOpts = {
    full,
    since: full ? null : (prior.cursor?.updatedAt ?? null),
    windowFrom: now() - BACKFILL_PAST_MS,
    windowTo: now() + BACKFILL_FUTURE_MS,
  };
  try {
    const st = await connector.status(auth);
    if (st.state === 'revoked') {
      const purged = store.revokeConnection(conn.id, 'revoked', now());
      return { ...empty('revoked', st.note), removed: purged.sources };
    }
    if (st.state === 'expired') {
      store.setStatus(conn.id, 'expired', st.note ?? 'The credential expired.');
      return done(empty('expired', st.note), 'expired');
    }
    if (st.state === 'rate_limited') throw new ConnectorRateLimitError(60_000, st.note);
    if (st.state === 'error') {
      store.setStatus(conn.id, 'error', st.note ?? 'Upstream rejected the credential.', true);
      return done(empty('degraded', st.note), 'degraded');
    }
    const items = await connector.listItems(auth, undefined, opts);
    const report: SyncReport = { ...empty('ok'), pass: full ? 'backfill' : 'incremental' };
    const seen = new Set<string>();
    let high = prior.cursor?.updatedAt ?? null;
    for (const item of items) {
      try {
        const content = await connector.fetchContent(auth, item);
        const { source, pieces } = normalizeItem(
          {
            ownerId: conn.ownerId,
            connectionId: conn.id,
            provider: conn.provider,
            mode: conn.mode,
            now: now(),
            ...(deps.retentionMs ? { retentionMs: deps.retentionMs } : {}),
          },
          item,
          content,
        );
        seen.add(source.id);
        if (item.modifiedAt !== null && (high === null || item.modifiedAt > high))
          high = item.modifiedAt;
        const r = store.upsertSource(source, pieces);
        if (r === 'added') report.added++;
        else if (r === 'updated') report.updated++;
        else if (r === 'unchanged') report.unchanged++;
        else report.duplicates++;
      } catch (e) {
        if (
          e instanceof ConnectorAuthError ||
          e instanceof ConnectorExpiredError ||
          e instanceof ConnectorRateLimitError
        )
          throw e;
        report.failed++;
      }
    }
    // Upstream no longer lists it: delete the derived copy so a removed doc cannot keep being cited.
    // Only a full pass lists everything, so only a full pass may conclude that something is gone.
    if (full)
      for (const s of store.sourcesOfConnection(conn.id)) {
        if (!seen.has(s.id) && report.failed === 0) {
          store.deleteSource(s.id, 'removed', now());
          report.removed++;
        }
      }
    store.patchConnection(conn.id, {
      status: 'live',
      degraded: false,
      statusNote: null,
      lastSyncAt: now(),
    });
    store.patchSyncState(conn.id, {
      cursor: { updatedAt: high ?? now(), windowFrom: opts.windowFrom, windowTo: opts.windowTo },
      ...(full && report.failed === 0 ? { lastFullAt: now() } : {}),
    });
    return done(report, 'ok');
  } catch (e) {
    if (e instanceof ConnectorRateLimitError) {
      const until = now() + Math.max(1_000, e.retryAfterMs);
      store.setStatus(
        conn.id,
        'rate_limited',
        'The provider asked us to slow down. Showing the last imported data; sync resumes automatically.',
      );
      store.patchSyncState(conn.id, { retryAfter: until });
      return done({ ...empty('rate_limited', 'rate limited'), retryAfter: until }, 'rate_limited');
    }
    if (e instanceof ConnectorExpiredError) {
      store.setStatus(conn.id, 'expired', 'The credential expired. Reconnect to resume syncing.');
      return done(empty('expired', 'credential expired'), 'expired');
    }
    if (e instanceof ConnectorAuthError) {
      store.setStatus(
        conn.id,
        'error',
        `The provider rejected the credential (${e.httpStatus}). Showing the last imported data.`,
        true,
      );
      return done(empty('degraded', `upstream ${e.httpStatus}`), 'degraded');
    }
    store.setStatus(conn.id, 'error', 'Sync failed. Showing the last imported data.', false);
    return done(empty('error', 'sync failed'), 'error');
  }
}
