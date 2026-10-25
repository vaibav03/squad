import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (scripts/demo/lib -> three levels up). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SEED_DIR = path.join(ROOT, 'scripts/demo/seed');

export function replayDir(env: NodeJS.ProcessEnv = process.env): string {
  const d = env.HUB_REPLAY_DIR;
  return d ? path.resolve(ROOT, d) : path.join(ROOT, 'apps/hub/sim/replays');
}

export function dbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(ROOT, env.DB_PATH || 'data/squad.db');
}

export function hubBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HUB_BASE_URL || 'http://localhost:8788').replace(/\/+$/, '');
}

export function webHostUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WEB_HOST_URL || 'http://localhost:5173').replace(/\/+$/, '');
}
