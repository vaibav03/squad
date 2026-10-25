import { createLogger as createCoreLogger, type Logger, type LogLevel } from '@squad/core';
import { traceFields } from './observability/context';

export type { Logger, LogLevel };

/** Structured JSON-line logger shared with the bot and agents (`@squad/core` telemetry): redacts keys,
 * tokens, secrets and withheld values, hashes student ids, and stamps the active correlation id. */
export function createLogger(
  level: LogLevel = 'info',
  sink?: (line: string) => void,
  salt?: string,
): Logger {
  return createCoreLogger({
    svc: 'hub',
    level,
    ...(sink ? { sink } : {}),
    ...(salt ? { salt } : {}),
    context: traceFields,
  });
}

export const silentLogger: Logger = createLogger('silent');
