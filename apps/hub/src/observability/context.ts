import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request (and per-event) ambient context. The logger reads `corr` from here, so every log line made
 * while handling a request carries the same correlation id without passing it around. */
export interface TraceContext {
  corr: string;
  route?: string;
}
const als = new AsyncLocalStorage<TraceContext>();

export const runWithTrace = <T>(ctx: TraceContext, fn: () => T): T => als.run(ctx, fn);
export const currentTrace = (): TraceContext | undefined => als.getStore();
export const currentCorr = (): string | undefined => als.getStore()?.corr;
/** Logger `context` hook. */
export const traceFields = (): Record<string, unknown> | undefined => {
  const t = als.getStore();
  return t ? { corr: t.corr } : undefined;
};
