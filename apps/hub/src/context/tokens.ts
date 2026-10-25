import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Db } from '@squad/core';

/** Everything secret about a connection. Lives only here, encrypted; never serialised into a response or log. */
export interface TokenSecrets {
  accessToken?: string;
  refreshToken?: string;
  /** Canvas calendar feed URL (a bearer secret in itself). */
  feedUrl?: string;
  /** Canvas personal access token and its institution base URL. */
  apiToken?: string;
  baseUrl?: string;
  /** Drive Picker selection (not secret, kept with the grant it belongs to). */
  pickedFileIds?: string[];
}

export interface TokenStore {
  put(connectionId: string, secrets: TokenSecrets): void;
  get(connectionId: string): TokenSecrets | undefined;
  delete(connectionId: string): void;
  /** True when a key came from the environment (not the dev fallback). */
  readonly keyFromEnv: boolean;
}

export class TokenKeyError extends Error {
  constructor() {
    super('CONTEXT_TOKEN_KEY (32 bytes, base64 or hex) is required to store connection tokens');
    this.name = 'TokenKeyError';
  }
}

/** Parses a 32-byte key given as 64 hex chars or base64; undefined if absent or malformed. */
export function parseTokenKey(raw: string | undefined): Buffer | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  const b = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  return b.length === 32 ? b : undefined;
}

/**
 * AES-256-GCM, one random IV per write, the connection id bound as AAD (a row copied to another
 * connection fails to decrypt). The key comes from `CONTEXT_TOKEN_KEY`; outside production a key is derived
 * from the session secret so local fixture mode works without setup. Production without a key refuses to store.
 */
export function createTokenStore(
  db: Db,
  opts: {
    keyEnv?: string | undefined;
    fallbackSecret: string;
    production: boolean;
    now: () => number;
  },
): TokenStore {
  db.exec(`CREATE TABLE IF NOT EXISTS ctx_tokens(
    connection_id TEXT PRIMARY KEY, iv BLOB NOT NULL, tag BLOB NOT NULL, ct BLOB NOT NULL, updated_at INTEGER NOT NULL)`);
  const fromEnv = parseTokenKey(opts.keyEnv);
  if (opts.keyEnv && !fromEnv) throw new TokenKeyError();
  const key: Buffer | undefined =
    fromEnv ??
    (opts.production
      ? undefined
      : Buffer.from(
          hkdfSync('sha256', opts.fallbackSecret, 'squad-context-tokens', 'dev-fallback', 32),
        ));
  const need = (): Buffer => {
    if (!key) throw new TokenKeyError();
    return key;
  };
  return {
    keyFromEnv: fromEnv !== undefined,
    put(id, secrets) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', need(), iv);
      c.setAAD(Buffer.from(id));
      const ct = Buffer.concat([c.update(JSON.stringify(secrets), 'utf8'), c.final()]);
      db.prepare(
        'INSERT OR REPLACE INTO ctx_tokens(connection_id, iv, tag, ct, updated_at) VALUES(?,?,?,?,?)',
      ).run(id, iv, c.getAuthTag(), ct, opts.now());
    },
    get(id) {
      const r = db.prepare('SELECT iv, tag, ct FROM ctx_tokens WHERE connection_id=?').get(id) as
        { iv: Buffer; tag: Buffer; ct: Buffer } | undefined;
      if (!r) return undefined;
      const d = createDecipheriv('aes-256-gcm', need(), r.iv);
      d.setAAD(Buffer.from(id));
      d.setAuthTag(r.tag);
      return JSON.parse(
        Buffer.concat([d.update(r.ct), d.final()]).toString('utf8'),
      ) as TokenSecrets;
    },
    delete(id) {
      db.prepare('DELETE FROM ctx_tokens WHERE connection_id=?').run(id);
    },
  };
}

/** Short stable fingerprint for logs ("which token") without revealing it. */
export const fingerprint = (secret: string): string =>
  createHmac('sha256', 'fp').update(secret).digest('hex').slice(0, 8);
