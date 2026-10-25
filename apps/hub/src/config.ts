import { isAbsolute, resolve } from 'node:path';
import { findRepoRoot } from '@squad/core/node';
import type { LogLevel } from './log';
import { normalizeOrigin } from './web-origin';

export interface HubConfig {
  port: number;
  baseUrl: string;
  internalSecret: string;
  authSecret: string;
  corsOrigins: string[];
  dbPath: string;
  replayDir: string;
  seed: boolean;
  sim: boolean;
  production: boolean;
  logLevel: LogLevel;
  /** HMAC key for session tokens and challenge codes (SESSION_SECRET). */
  sessionSecret: string;
  /** Pepper for hashed phone/email (CONTACT_PEPPER, defaults to the session secret). */
  contactPepper: string;
  /** Enables dev-login, the student picker list and `devCode` in /v1/auth/start (HUB_DEV_LOGIN). */
  devLogin: boolean;
  squadMax: number;
  sessionDays: number;
  /** Base of invite links (HUB_WEB_URL). */
  webUrl: string;
  /** Explicitly configured public web origin (PUBLIC_WEB_URL, WEB_URL or HUB_WEB_URL); null when none was set. */
  publicWebUrl?: string | null;
  codeSender: 'console' | 'imessage';
  imessageSendUrl: string | null;
  /** SSE tuning (overridable in tests) */
  sse: { bufferSize: number; maxQueue: number; pingMs: number };
}

const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === '' ? d : v === '1' || v === 'true';

export function loadHubConfig(env: Record<string, string | undefined> = process.env): HubConfig {
  const production = env.NODE_ENV === 'production';
  const baseUrl = (env.HUB_BASE_URL || 'http://localhost:8788').replace(/\/+$/, '');
  let urlPort = 8788;
  try {
    urlPort = Number(new URL(baseUrl).port) || 8788;
  } catch {
    /* keep default */
  }
  const internalSecret =
    env.INTERNAL_EVENTS_SECRET ||
    env.HUB_INTERNAL_SECRET ||
    env.NOOK_INTERNAL_SECRET ||
    'change-me';
  const root = findRepoRoot();
  const authSecret = env.HUB_AUTH_SECRET || `auth:${internalSecret}`;
  const sessionSecret = env.SESSION_SECRET || `session:${authSecret}`;
  if (production && (env.SESSION_SECRET ?? '').length < 32)
    throw new Error('SESSION_SECRET (at least 32 characters) is required in production');
  const corsOrigins = (env.HUB_CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    port: Number(env.HUB_PORT) || urlPort,
    baseUrl,
    internalSecret,
    authSecret,
    corsOrigins,
    dbPath: resolveDbPath(env.DB_PATH, root, env),
    replayDir: env.HUB_REPLAY_DIR
      ? resolve(env.HUB_REPLAY_DIR)
      : resolve(root, 'apps/hub/sim/replays'),
    seed: bool(env.HUB_SEED, !production),
    sim: bool(env.HUB_SIM, !production),
    production,
    logLevel: (env.HUB_LOG as LogLevel) || 'info',
    sessionSecret,
    contactPepper: env.CONTACT_PEPPER || sessionSecret,
    devLogin: bool(env.HUB_DEV_LOGIN, !production),
    squadMax: Math.max(3, Number(env.HUB_SQUAD_MAX) || 12),
    sessionDays: Math.max(1, Number(env.HUB_SESSION_DAYS) || 30),
    webUrl: (
      env.PUBLIC_WEB_URL ||
      env.WEB_URL ||
      env.HUB_WEB_URL ||
      corsOrigins.find((o) => o !== '*') ||
      'http://localhost:5180'
    ).replace(/\/+$/, ''),
    publicWebUrl: normalizeOrigin(
      env.PUBLIC_WEB_URL || env.WEB_URL || env.HUB_WEB_URL || undefined,
    ),
    codeSender: env.CODE_SENDER === 'imessage' ? 'imessage' : 'console',
    imessageSendUrl: env.IMESSAGE_SEND_URL || null,
    sse: { bufferSize: 5000, maxQueue: 256, pingMs: 15_000 },
  };
}

/** `:memory:` stays as is; relative file paths are anchored at the repo root; unit tests default to memory. */
function resolveDbPath(
  raw: string | undefined,
  root: string,
  env: Record<string, string | undefined>,
): string {
  if (!raw) return env.VITEST ? ':memory:' : resolve(root, 'data/squad.db');
  if (raw === ':memory:' || isAbsolute(raw)) return raw;
  return resolve(root, raw);
}

/** Safe to log: never includes secret values. */
export function describeHubConfig(c: HubConfig): Record<string, unknown> {
  return {
    port: c.port,
    baseUrl: c.baseUrl,
    internalSecret: c.internalSecret === 'change-me' ? 'default' : 'set',
    corsOrigins: c.corsOrigins,
    dbPath: c.dbPath,
    seed: c.seed,
    sim: c.sim,
    devLogin: c.devLogin,
    codeSender: c.codeSender,
  };
}
