// A local fake Sendblue (tests and the fixture e2e): the send API (1:1 and group), account lines, a media CDN, and a
// webhook delivery side that signs requests exactly the way Sendblue does (shared secret in a header). It runs on its
// own port and NEVER talks to the real Sendblue: the hub's SENDBLUE_API_BASE points here.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeSendOptions {
  apiKey: string;
  apiSecret: string;
  /** The hub's webhook secret the fake echoes in the header on every delivery. */
  webhookSecret: string;
  secretHeader?: string;
  /** Deliver a webhook to the hub. In-process (`hub.app.request`) or over HTTP. */
  post: (
    path: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<Response>;
  port?: number;
}

export interface SentRecord {
  endpoint: 'send-message' | 'send-group-message';
  body: Record<string, unknown>;
  handle: string;
  authOk: boolean;
}

export interface FakeSendblue {
  readonly url: string;
  readonly port: number;
  readonly sent: SentRecord[];
  /** Every request that reached the fake (any path), for the "never called" assertions. */
  readonly requests: string[];
  /** Fail the next `n` sends with this Sendblue error (HTTP 400 + error_code). */
  failNext(n: number, code?: number, http?: number): void;
  media(name: string, bytes: Uint8Array): string;
  /** An inbound message as a Sendblue `receive` webhook. */
  inbound(m: {
    from: string;
    content: string;
    handle?: string;
    groupId?: string;
    mediaUrl?: string;
    dateSent?: Date;
    headers?: Record<string, string>;
    secret?: string | null;
    raw?: (body: string) => string;
    path?: string;
  }): Promise<Response>;
  /** A status callback for a message handle. */
  status(h: {
    handle: string;
    status: string;
    errorCode?: number | null;
    groupId?: string;
    secret?: string | null;
    path?: string;
  }): Promise<Response>;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => res(b));
  });

export async function startFakeSendblue(o: FakeSendOptions): Promise<FakeSendblue> {
  const sent: SentRecord[] = [];
  const requests: string[] = [];
  const files = new Map<string, Uint8Array>();
  let fails: { n: number; code: number; http: number } = { n: 0, code: 10001, http: 400 };
  let seq = 0;
  const headerName = o.secretHeader ?? 'sb-signing-secret';
  const handleN = () => `FAKE-${String(++seq).padStart(6, '0')}`;

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0]!;
    requests.push(`${req.method} ${path}`);
    const json = (code: number, b: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (req.method === 'GET' && path.startsWith('/media/')) {
      const f = files.get(path.slice(7));
      if (!f) return json(404, {});
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': f.length,
      });
      return void res.end(Buffer.from(f));
    }
    const authOk =
      req.headers['sb-api-key-id'] === o.apiKey && req.headers['sb-api-secret-key'] === o.apiSecret;
    if (!authOk) return json(401, { status: 'ERROR', message: 'Unauthorized' });
    if (req.method === 'GET' && path === '/api/lines') {
      return json(200, { lines: [{ number: '+15550009999' }] });
    }
    if (
      req.method === 'POST' &&
      (path === '/api/send-message' || path === '/api/send-group-message')
    ) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      if (fails.n > 0) {
        fails.n--;
        return json(fails.http, {
          status: 'ERROR',
          error_code: fails.code,
          error_message: 'fake failure',
        });
      }
      const handle = handleN();
      sent.push({
        endpoint: path === '/api/send-message' ? 'send-message' : 'send-group-message',
        body,
        handle,
        authOk,
      });
      return json(200, {
        status: 'QUEUED',
        message_handle: handle,
        ...(path.endsWith('group-message') ? { group_id: String(body.group_id ?? '') } : {}),
      });
    }
    return json(404, { status: 'ERROR', message: 'not found' });
  });
  await new Promise<void>((r) => server.listen(o.port ?? 0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const deliver = (
    path: string,
    body: string,
    secret: string | null | undefined,
    extra: Record<string, string> = {},
  ) =>
    o.post(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { [headerName]: secret ?? o.webhookSecret }),
        ...extra,
      },
      body,
    });

  return {
    url,
    port,
    sent,
    requests,
    failNext(n, code = 10001, http = 400) {
      fails = { n, code, http };
    },
    media(name, bytes) {
      files.set(name, bytes);
      return `${url}/media/${name}`;
    },
    inbound(m) {
      const payload = {
        accountEmail: 'fixture@example.test',
        content: m.content,
        is_outbound: false,
        status: 'RECEIVED',
        error_code: null,
        message_handle: m.handle ?? handleN(),
        date_sent: (m.dateSent ?? new Date()).toISOString(),
        date_updated: (m.dateSent ?? new Date()).toISOString(),
        from_number: m.from,
        number: m.from,
        to_number: '+15550009999',
        media_url: m.mediaUrl ?? '',
        group_id: m.groupId ?? '',
        participants: m.groupId ? [m.from, '+15550009999'] : [m.from, '+15550009999'],
        service: 'iMessage',
        sendblue_number: '+15550009999',
      };
      const body = (m.raw ?? ((b) => b))(JSON.stringify(payload));
      return deliver(m.path ?? '/v1/webhooks/sendblue', body, m.secret, m.headers);
    },
    status(h) {
      const body = JSON.stringify({
        accountEmail: 'fixture@example.test',
        is_outbound: true,
        status: h.status,
        error_code: h.errorCode ?? null,
        error_message: h.errorCode ? 'fake failure' : null,
        message_handle: h.handle,
        date_updated: new Date().toISOString(),
        group_id: h.groupId ?? '',
        service: 'iMessage',
      });
      return deliver(h.path ?? '/v1/webhooks/sendblue/status', body, h.secret);
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
