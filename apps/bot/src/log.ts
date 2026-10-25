import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import type { Logger } from './types';

const REDACT = ['*key*', '*secret*', '*token*', '*.apiKey', '*.password'];

export function createLogger(opts: { file?: string; level?: string } = {}): Logger {
  const quiet = !!process.env.VITEST || process.env.NODE_ENV === 'test';
  const level = opts.level ?? process.env.LOG_LEVEL ?? (quiet ? 'silent' : 'info');
  const redact = { paths: REDACT, censor: '[redacted]' };
  const file = opts.file ?? (quiet ? undefined : 'logs/bot.log');
  if (!file) return pino({ level, redact }) as unknown as Logger;
  mkdirSync(dirname(file), { recursive: true });
  return pino(
    { level, redact },
    pino.multistream([{ stream: process.stdout }, { stream: pino.destination(file) }]),
  ) as unknown as Logger;
}

export const nullLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/** Logger that records everything (tests assert nothing sensitive was logged). */
export function spyLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const f = (level: string) => (a: Record<string, unknown> | string, m?: string) => {
    lines.push(JSON.stringify({ level, a, m }));
  };
  return { lines, info: f('info'), warn: f('warn'), error: f('error'), debug: f('debug') };
}

export const clip = (s: string, n = 80): string => (s.length > n ? `${s.slice(0, n)}...` : s);
