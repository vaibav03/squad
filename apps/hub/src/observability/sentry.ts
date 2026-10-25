import { redactString, type CapturedError } from '@squad/core';

export interface SentryOptions {
  /** `https://<key>@<host>/<project>`. Empty = hook is off and nothing ever touches the network. */
  dsn?: string;
  release?: string;
  environment?: string;
  fetch?: typeof fetch;
}

export interface SentryHook {
  enabled: boolean;
  send(e: CapturedError): void;
}

export function parseDsn(dsn: string): { url: string; auth: string } | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, '');
    if (!u.username || !project) return null;
    return {
      url: `${u.protocol}//${u.host}/api/${project}/envelope/`,
      auth: `Sentry sentry_version=7, sentry_client=squad-obs/1, sentry_key=${u.username}`,
    };
  } catch {
    return null;
  }
}

/**
 * Sentry-compatible, optional and off by default. Sends one envelope per captured error: type, scrubbed
 * message, first stack frames and the correlation id. Never request bodies, headers, or student data.
 */
export function createSentryHook(o: SentryOptions): SentryHook {
  const parsed = o.dsn ? parseDsn(o.dsn) : null;
  if (!parsed) return { enabled: false, send() {} };
  const f = o.fetch ?? fetch;
  return {
    enabled: true,
    send(e) {
      const eventId = crypto.randomUUID().replace(/-/g, '');
      const event = {
        event_id: eventId,
        timestamp: e.ts / 1000,
        platform: 'node',
        level: 'error',
        release: o.release,
        environment: o.environment ?? 'production',
        tags: { kind: e.kind, ...(e.corr ? { corr: e.corr } : {}) },
        exception: {
          values: [
            {
              type: e.name,
              value: redactString(e.message, 300),
              ...(e.stack
                ? { stacktrace: { frames: [{ filename: redactString(e.stack, 1200) }] } }
                : {}),
            },
          ],
        },
      };
      const body =
        JSON.stringify({ event_id: eventId }) +
        '\n' +
        JSON.stringify({ type: 'event' }) +
        '\n' +
        JSON.stringify(event);
      void f(parsed.url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': parsed.auth },
        body,
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    },
  };
}
