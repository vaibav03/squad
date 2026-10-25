import type { Connector } from './connectors/types';
import { ConnectorAuthError, ConnectorExpiredError } from './connectors/types';
import { normalizeItem } from './normalize';
import type { ContextStore } from './store';
import type { ContextConnection } from './types';

export interface SyncReport {
  outcome: 'ok' | 'skipped' | 'expired' | 'revoked' | 'degraded' | 'error';
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
}

/**
 * One sync pass: probe status, list, fetch, normalise (chunk + hash), dedupe, index. Expired connections never
 * call upstream (sync stops); a revoked grant purges everything; a 401 marks the connection degraded and keeps
 * what was already imported. Never throws on upstream failure.
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
  if (conn.status === 'revoked') return empty('revoked', 'connection was revoked');
  if (conn.status === 'expired')
    return empty('expired', 'credential expired; reconnect to resume syncing');
  if (conn.expiresAt !== null && conn.expiresAt <= now()) {
    store.setStatus(conn.id, 'expired', 'The credential expired. Reconnect to resume syncing.');
    return empty('expired', 'credential expired');
  }
  try {
    const st = await connector.status(auth);
    if (st.state === 'revoked') {
      const purged = store.revokeConnection(conn.id, 'revoked', now());
      return { ...empty('revoked', st.note), removed: purged.sources };
    }
    if (st.state === 'expired') {
      store.setStatus(conn.id, 'expired', st.note ?? 'The credential expired.');
      return empty('expired', st.note);
    }
    if (st.state === 'error') {
      store.setStatus(conn.id, 'error', st.note ?? 'Upstream rejected the credential.', true);
      return empty('degraded', st.note);
    }
    const items = await connector.listItems(auth);
    const report = empty('ok');
    const seen = new Set<string>();
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
        const r = store.upsertSource(source, pieces);
        if (r === 'added') report.added++;
        else if (r === 'updated') report.updated++;
        else if (r === 'unchanged') report.unchanged++;
        else report.duplicates++;
      } catch (e) {
        if (e instanceof ConnectorAuthError || e instanceof ConnectorExpiredError) throw e;
        report.failed++;
      }
    }
    // Upstream no longer lists it: delete the derived copy so a removed doc cannot keep being cited.
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
    return report;
  } catch (e) {
    if (e instanceof ConnectorExpiredError) {
      store.setStatus(conn.id, 'expired', 'The credential expired. Reconnect to resume syncing.');
      return empty('expired', 'credential expired');
    }
    if (e instanceof ConnectorAuthError) {
      store.setStatus(
        conn.id,
        'error',
        `The provider rejected the credential (${e.httpStatus}). Showing the last imported data.`,
        true,
      );
      return empty('degraded', `upstream ${e.httpStatus}`);
    }
    store.setStatus(conn.id, 'error', 'Sync failed. Showing the last imported data.', false);
    return empty('error', 'sync failed');
  }
}
