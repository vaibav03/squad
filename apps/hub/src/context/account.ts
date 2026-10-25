// Display identity of a connected account: a MASKED label (never the raw e-mail), an optional name and the Canvas host.
// Not secret by design (it is shown on Connections); the raw e-mail / Canvas user id is never stored here.
import type { Db } from '@squad/core';

export const FIXTURE_ACCOUNT_LABEL = 'Fixture (simulated, not your account)';

export interface AccountInfo {
  label: string;
  name?: string;
  host?: string;
}

/** `vaibav@gmail.com` -> `v*****@gmail.com`; anything that is not an address becomes `masked account`. */
export function maskEmail(email: string | null | undefined): string {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email ?? '');
  if (!m) return 'Google account (e-mail not shared)';
  const local = m[1]!;
  return `${local[0]}${'*'.repeat(Math.min(5, Math.max(3, local.length - 1)))}@${m[2]}`;
}

export interface AccountStore {
  set(connectionId: string, info: AccountInfo | null): void;
  get(connectionId: string): AccountInfo | null;
  delete(connectionId: string): void;
}

export function createAccountStore(db: Db): AccountStore {
  db.exec(`CREATE TABLE IF NOT EXISTS ctx_account_info(
    connection_id TEXT PRIMARY KEY, label TEXT NOT NULL, name TEXT, host TEXT)`);
  return {
    set(id, info) {
      if (!info) {
        db.prepare('DELETE FROM ctx_account_info WHERE connection_id=?').run(id);
        return;
      }
      db.prepare('INSERT OR REPLACE INTO ctx_account_info(connection_id,label,name,host) VALUES(?,?,?,?)').run(
        id,
        info.label.slice(0, 200),
        info.name?.slice(0, 120) ?? null,
        info.host?.slice(0, 200) ?? null,
      );
    },
    get(id) {
      const r = db.prepare('SELECT label,name,host FROM ctx_account_info WHERE connection_id=?').get(id) as
        | { label: string; name: string | null; host: string | null }
        | undefined;
      return r ? { label: r.label, ...(r.name ? { name: r.name } : {}), ...(r.host ? { host: r.host } : {}) } : null;
    },
    delete(id) {
      db.prepare('DELETE FROM ctx_account_info WHERE connection_id=?').run(id);
    },
  };
}
