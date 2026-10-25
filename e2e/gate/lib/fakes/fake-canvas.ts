// Fake Canvas: the calendar feed (.ics) plus a minimal REST surface for the optional token path.
// Controls (loopback only): POST /_ctl/mode {mode: ok|404|410|moved}, POST /_ctl/token {valid:boolean}, GET /_ctl/requests.
import http from 'node:http';
import { SENTINELS } from '../config';
import { ASSIGNMENTS, COURSE, feedIcs } from './content';

export interface FakeServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export const FEED_SECRET = `${SENTINELS.feedSecret}_9f3a1c`;
export const CANVAS_TOKEN = 'canvas-fake-token-1234';

export async function startFakeCanvas(port: number): Promise<FakeServer> {
  const base = `http://localhost:${port}`;
  let mode: 'ok' | '404' | '410' | 'moved' | 'big' = 'ok';
  let tokenValid = true;
  let etagN = 1;
  const requests: { method: string; path: string; at: number }[] = [];

  const srv = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', base);
    const p = u.pathname;
    const send = (code: number, body: string, type = 'application/json', h = {}) => {
      res.writeHead(code, { 'content-type': type, ...h });
      res.end(body);
    };
    if (p.startsWith('/_ctl/')) {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => {
        const b = s ? JSON.parse(s) : {};
        if (p === '/_ctl/mode') mode = b.mode;
        if (p === '/_ctl/token') tokenValid = !!b.valid;
        if (p === '/_ctl/bump') etagN++;
        if (p === '/_ctl/reset') {
          mode = 'ok';
          tokenValid = true;
          requests.length = 0;
        }
        send(200, JSON.stringify(p === '/_ctl/requests' ? { requests } : { ok: true, mode }));
      });
      return;
    }
    requests.push({ method: req.method ?? 'GET', path: p, at: Date.now() });
    if (p === `/feeds/${FEED_SECRET}/calendar.ics`) {
      if (mode === '404') return send(404, 'not found', 'text/plain');
      if (mode === '410') return send(410, 'gone', 'text/plain');
      if (mode === 'moved')
        return send(301, '', 'text/plain', { location: 'http://moved.invalid/calendar.ics' });
      const etag = `"feed-${etagN}"`;
      if (req.headers['if-none-match'] === etag) return send(304, '', 'text/plain', { etag });
      return send(200, feedIcs(base, mode === 'big' ? 600 : 0), 'text/calendar', { etag });
    }
    if (p.startsWith('/api/v1/')) {
      const ok = req.headers.authorization === `Bearer ${CANVAS_TOKEN}` && tokenValid;
      if (!ok) return send(401, JSON.stringify({ errors: [{ message: 'Invalid access token.' }] }));
      if (p === '/api/v1/courses')
        return send(200, JSON.stringify([{ id: COURSE.id, name: COURSE.name, course_code: COURSE.code }]));
      if (p === `/api/v1/courses/${COURSE.id}/assignments`)
        return send(
          200,
          JSON.stringify(
            ASSIGNMENTS.map((a) => ({
              id: a.id,
              name: a.title,
              due_at: a.dueAt,
              description: a.description,
              html_url: `${base}/courses/${COURSE.id}/assignments/${a.id}`,
              // present on the wire on purpose: the connector must drop it at parse
              submission: { score: SENTINELS.grade, grade: SENTINELS.grade },
            })),
          ),
        );
      return send(404, '{}');
    }
    send(404, 'not found', 'text/plain');
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return {
    port,
    url: base,
    close: () =>
      new Promise<void>((r) => {
        srv.close(() => r());
        srv.closeAllConnections?.();
      }),
  };
}
export const canvasFeedUrl = (port: number) =>
  `http://localhost:${port}/feeds/${FEED_SECRET}/calendar.ics`;
