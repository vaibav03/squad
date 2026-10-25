// Thin Sendblue REST client (docs.sendblue.com). Headers: `sb-api-key-id` / `sb-api-secret-key`.
//   1:1    POST /api/send-message        {number, from_number, content, media_url?, status_callback?}
//   group  POST /api/send-group-message  {group_id, from_number, content, media_url?, status_callback?}
//   probe  GET  /api/lines               (account line status; sends nothing)
// `fetch` is injected: tests point it at the fake Sendblue server and nothing here ever talks to the network on import.
import { redact, type SendblueConfig } from './config';

export class SendblueError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    /** Sendblue `error_code` (4001, 10001, ...) or `http_<status>`; safe to show. */
    readonly code: string,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = 'SendblueError';
  }
}

export interface SendResult {
  handle: string;
  status: string;
  groupId?: string;
}

export interface SendblueClient {
  sendMessage(r: {
    number: string;
    content: string;
    mediaUrl?: string;
    statusCallback?: string;
  }): Promise<SendResult>;
  sendGroupMessage(r: {
    groupId: string;
    content: string;
    mediaUrl?: string;
    statusCallback?: string;
  }): Promise<SendResult>;
  /** Account line status. Never sends a message. */
  lines(): Promise<{ count: number; numbers: string[] }>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 15_000;

export function createSendblueClient(
  cfg: SendblueConfig,
  fetchFn: FetchLike = fetch,
): SendblueClient {
  const headers = () => ({
    'content-type': 'application/json',
    'sb-api-key-id': cfg.apiKey,
    'sb-api-secret-key': cfg.apiSecret,
  });

  async function call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(`${cfg.apiBase}${path}`, {
        method,
        headers: headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new SendblueError(redact(`network: ${(e as Error).name}`, cfg), 0, 'network');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errCode = json.error_code ?? json.error_key;
    const failed = !res.ok || json.status === 'ERROR' || json.status === 'DECLINED';
    if (failed) {
      const ra = Number(res.headers.get('retry-after'));
      const code = errCode != null ? String(errCode) : `http_${res.status}`;
      throw new SendblueError(
        redact(`sendblue ${path} failed (${res.status}, ${code})`, cfg),
        res.status,
        code,
        Number.isFinite(ra) && ra > 0 ? ra : undefined,
      );
    }
    return json;
  }

  const result = (j: Record<string, unknown>): SendResult => {
    const handle = typeof j.message_handle === 'string' ? j.message_handle : '';
    if (!handle)
      throw new SendblueError('sendblue response had no message_handle', 502, 'no_handle');
    return {
      handle,
      status: typeof j.status === 'string' ? j.status : 'QUEUED',
      ...(typeof j.group_id === 'string' && j.group_id ? { groupId: j.group_id } : {}),
    };
  };

  return {
    async sendMessage(r) {
      return result(
        await call('POST', '/api/send-message', {
          number: r.number,
          from_number: cfg.fromNumber,
          content: r.content,
          ...(r.mediaUrl ? { media_url: r.mediaUrl } : {}),
          ...(r.statusCallback ? { status_callback: r.statusCallback } : {}),
        }),
      );
    },
    async sendGroupMessage(r) {
      return result(
        await call('POST', '/api/send-group-message', {
          group_id: r.groupId,
          from_number: cfg.fromNumber,
          content: r.content,
          ...(r.mediaUrl ? { media_url: r.mediaUrl } : {}),
          ...(r.statusCallback ? { status_callback: r.statusCallback } : {}),
        }),
      );
    },
    async lines() {
      const j = await call('GET', '/api/lines');
      const raw = Array.isArray(j) ? j : Array.isArray(j.lines) ? j.lines : [];
      const numbers = (raw as unknown[]).flatMap((l) => {
        if (typeof l === 'string') return [l];
        const o = l as Record<string, unknown>;
        const n = o.number ?? o.phone_number ?? o.from_number;
        return typeof n === 'string' ? [n] : [];
      });
      return { count: numbers.length, numbers };
    },
  };
}
