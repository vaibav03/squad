import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { INTERNAL_HEADER } from '@squad/core';
import { nullLogger } from './log';
import type { ConfirmApi, Logger } from './types';

export const CONFIRM_PATH = '/internal/confirm';
export const DEFAULT_BOT_PORT = 8790;

const Body = z.strictObject({
  student: z.string().min(1),
  question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1)).min(1).max(9),
  taskId: z.string().min(1),
});

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > max) {
        reject(new Error('body too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * POST /internal/confirm for standalone agents: runs the normal confirm flow (numbered DM, timeout)
 * and answers `{ answer }`. Guarded by the X-Nook-Internal header (same secret as /internal/events).
 */
export function createInternalServer(deps: {
  confirms: Pick<ConfirmApi, 'ask'>;
  secret: string;
  log?: Logger;
}): Server {
  const log = deps.log ?? nullLogger;
  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url !== CONFIRM_PATH) return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const given = req.headers[INTERNAL_HEADER.toLowerCase()];
      if (typeof given !== 'string' || !deps.secret || !safeEq(given, deps.secret)) {
        return send(res, 401, { error: 'unauthorized' });
      }
      let parsed: z.infer<typeof Body>;
      try {
        parsed = Body.parse(JSON.parse(await readBody(req)));
      } catch (e) {
        return send(res, 400, {
          error: e instanceof z.ZodError ? 'invalid body' : (e as Error).message,
        });
      }
      try {
        const answer = await deps.confirms.ask(
          parsed.student,
          parsed.question,
          parsed.options,
          parsed.taskId,
        );
        send(res, 200, { answer });
      } catch (e) {
        log.warn({ taskId: parsed.taskId, err: (e as Error).message }, 'internal confirm failed');
        send(res, 409, { error: (e as Error).message });
      }
    })();
  });
  server.requestTimeout = 0; // a confirm can legitimately take 10 minutes
  return server;
}
