import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const blank = (v: unknown) => (v === '' ? undefined : v);
const opt = z.preprocess(blank, z.string().optional());

export const ConfigSchema = z.object({
  GEMINI_API_KEY: opt,
  GEMINI_MODEL_FAST: opt,
  GEMINI_MODEL_MAIN: opt,
  GEMINI_MODEL_CHAIR: opt,
  ELEVENLABS_API_KEY: opt,
  HUB_BASE_URL: z.preprocess(blank, z.string().url().default('http://localhost:8788')),
  INTERNAL_EVENTS_SECRET: z.preprocess(blank, z.string().default('change-me')),
  DB_PATH: z.preprocess(blank, z.string().default('data/squad.db')),
  SQUAD_LIVE: z.preprocess(blank, z.enum(['0', '1']).default('0')),
});

export interface Config {
  geminiApiKey?: string;
  geminiModels: { fast?: string; main?: string; chair?: string };
  elevenLabsApiKey?: string;
  hubBaseUrl: string;
  internalEventsSecret: string;
  dbPath: string;
  live: boolean; // SQUAD_LIVE=1 enables real-key tests
}

/** Walk up from `from` to the directory holding pnpm-workspace.yaml (the repo root). */
export function findRepoRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(from);
    dir = up;
  }
}

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>; // default process.env
  envFile?: string | false; // default <repo root>/.env; false to skip reading a file
}

/**
 * Load config from `.env` (never overriding real environment variables) and validate it.
 * Secrets are returned but must never be logged: use `describeConfig` for logging.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const base = opts.env ?? process.env;
  let fromFile: Record<string, string> = {};
  const file = opts.envFile === false ? undefined : (opts.envFile ?? join(findRepoRoot(), '.env'));
  if (file && existsSync(file)) fromFile = dotenv.parse(readFileSync(file));
  const e = ConfigSchema.parse({ ...fromFile, ...base });
  return {
    geminiApiKey: e.GEMINI_API_KEY,
    geminiModels: {
      fast: e.GEMINI_MODEL_FAST,
      main: e.GEMINI_MODEL_MAIN,
      chair: e.GEMINI_MODEL_CHAIR,
    },
    elevenLabsApiKey: e.ELEVENLABS_API_KEY,
    hubBaseUrl: e.HUB_BASE_URL,
    internalEventsSecret: e.INTERNAL_EVENTS_SECRET,
    dbPath: e.DB_PATH,
    live: e.SQUAD_LIVE === '1',
  };
}

/** Safe-to-log summary: only whether keys are set. */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    geminiApiKey: c.geminiApiKey ? 'set' : 'missing',
    elevenLabsApiKey: c.elevenLabsApiKey ? 'set' : 'missing',
    internalEventsSecret: c.internalEventsSecret === 'change-me' ? 'default' : 'set',
    hubBaseUrl: c.hubBaseUrl,
    dbPath: c.dbPath,
    live: c.live,
  };
}
