export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
}

/** Structured JSON-line logger. Callers must never pass event bodies, free text or secrets as fields. */
export function createLogger(
  level: LogLevel = 'info',
  sink: (line: string) => void = (l) => process.stderr.write(l + '\n'),
): Logger {
  const emit = (lv: Exclude<LogLevel, 'silent'>) => (msg: string, f?: Record<string, unknown>) => {
    if (order[lv] < order[level]) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lv, svc: 'hub', msg, ...f }));
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const silentLogger: Logger = createLogger('silent');
