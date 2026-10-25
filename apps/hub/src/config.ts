import { resolve } from 'node:path';
import { findRepoRoot } from '@squad/core/node';
import type { LogLevel } from './log';

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
  return {
    port: Number(env.HUB_PORT) || urlPort,
    baseUrl,
    internalSecret,
    authSecret: env.HUB_AUTH_SECRET || `auth:${internalSecret}`,
    corsOrigins: (env.HUB_CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dbPath: env.DB_PATH || 'data/squad.db',
    replayDir: env.HUB_REPLAY_DIR
      ? resolve(env.HUB_REPLAY_DIR)
      : resolve(root, 'apps/hub/sim/replays'),
    seed: bool(env.HUB_SEED, !production),
    sim: bool(env.HUB_SIM, !production),
    production,
    logLevel: (env.HUB_LOG as LogLevel) || 'info',
    sse: { bufferSize: 5000, maxQueue: 256, pingMs: 15_000 },
  };
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
  };
}
