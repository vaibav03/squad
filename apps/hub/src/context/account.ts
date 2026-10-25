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

/** Course records per connection live in the context store (so retrieval and citations resolve them too). */
export interface CourseNameStore {
  replace(connectionId: string, courses: { id: string; name: string; code?: string | null }[]): void;
  /** "CODE: Name" (or the best available words) for a source's course. */
  name(connectionId: string | null, courseId: string | null): string | null;
  info(connectionId: string | null, courseId: string | null): { name: string; code: string | null; label: string } | null;
  delete(connectionId: string): void;
}
/** The demo / fixture account card: never "None". */
export const DEMO_ACCOUNT = { label: 'Demo workspace (simulated)', name: 'Demo student' } as const;

const SCOPE_WORDS: Record<string, string> = {
  'calendar.readonly': 'Read your calendar events (cannot edit them)',
  'classroom.courses.readonly': 'See your Classroom course list',
  'classroom.coursework.me.readonly': 'Read your own Classroom assignments and due dates',
  'drive.file': 'Open only the Drive files you pick',
  'canvas.calendar_feed': 'Read your Canvas calendar feed (dates and titles)',
  'canvas.api_token.read': 'Read your courses, assignments and files with your token',
  'canvas.browser_session.read': 'Read Canvas through your own signed-in browser session',
  'canvas.demo_workspace': 'Demo workspace only: simulated content, no account is read',
};
export const scopeLabel = (short: string): string => SCOPE_WORDS[short] ?? `Read-only access: ${short}`;
