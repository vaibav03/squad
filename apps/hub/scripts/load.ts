/**
 * Load script: N SSE clients (some deliberately slow) while events are posted to /internal/events.
 *
 *   pnpm --filter @squad/hub load                 # boots an in-process hub, 50 clients, 500 events
 *   HUB_URL=http://localhost:8788 SECRET=... pnpm --filter @squad/hub load   # against a running hub
 *
 * Checks: every fast client receives every event once and in order; slow clients are dropped (bounded
 * memory); the subscriber count returns to zero; reports latency percentiles and heap growth.
 */
import http from 'node:http';
import net from 'node:net';
import { startHub } from '../src/server';

export interface LoadOptions {
  url?: string;
  secret?: string;
  clients?: number;
  slow?: number;
  events?: number;
  ratePerSec?: number;
}
export interface LoadReport {
  clients: number;
  slowClients: number;
  events: number;
  missing: number;
  outOfOrder: number;
  duplicates: number;
  slowDropped: number;
  p50Ms: number;
  p99Ms: number;
  heapGrowthMb: number;
  subscribersAfter: number | null;
  subscribersBeforeClose: number | null;
}

const j = (url: string, path: string, init: RequestInit = {}) =>
  fetch(url + path, init).then((r) => r.json() as Promise<Record<string, unknown>>);

export async function runLoad(o: LoadOptions = {}): Promise<LoadReport> {
  const clients = o.clients ?? 50;
  const slow = o.slow ?? 5;
  const total = o.events ?? 500;
  let own: Awaited<ReturnType<typeof startHub>> | undefined;
  let url = o.url;
  const secret = o.secret ?? 'load-secret';
  if (!url) {
    own = await startHub({
      config: {
        port: 0,
        internalSecret: secret,
        authSecret: 'load-auth',
        logLevel: 'silent',
        seed: true,
        sim: false,
        sse: { bufferSize: 5000, maxQueue: 256, pingMs: 15_000 },
      },
    });
    url = own.url;
  }
  const base = url;
  const ids = ['s_ana', 's_ben', 's_chi', 's_dev'];
  const tokens: string[] = [];
  for (const id of ids)
    tokens.push(
      (
        await j(base, '/v1/auth/dev-login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ studentId: id }),
        })
      ).token as string,
    );

  const heap0 = process.memoryUsage().heapUsed;
  const sentAt = new Map<number, number>();
  const lat: number[] = [];
  const fast: { seen: number[]; req: http.ClientRequest }[] = [];
  const slowSocks: net.Socket[] = [];

  const open = async (i: number, stall: boolean) => {
    const st = (
      await j(base, '/v1/squad/stream-token', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens[i % tokens.length]}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
    ).st as string;
    return new Promise<void>((resolve) => {
      const seen: number[] = [];
      if (stall) {
        // raw socket that never reads: kernel buffers fill and the hub must drop this subscriber
        const u = new URL(base);
        const sock = net.connect(Number(u.port), u.hostname);
        sock.on('error', () => undefined);
        sock.write(`GET /v1/squad/stream?st=${st} HTTP/1.1\r\nHost: ${u.host}\r\n\r\n`);
        sock.pause();
        slowSocks.push(sock);
        setTimeout(resolve, 100);
        return;
      }
      const req = http.get(`${base}/v1/squad/stream?st=${st}`, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          buf += c;
          let k: number;
          while ((k = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, k);
            buf = buf.slice(k + 2);
            const m = /^id: (\d+)$/m.exec(frame);
            if (!m || !/^event: agent\.state$/m.test(frame)) continue;
            const d = /^data: (.*)$/m.exec(frame)?.[1];
            const n = d
              ? (JSON.parse(d) as { agent: string }).agent.match(/^student:load(\d+)$/)?.[1]
              : undefined;
            if (n === undefined) continue; // only our load events
            seen.push(Number(n));
            const t0 = sentAt.get(Number(n));
            if (t0) lat.push(performance.now() - t0);
          }
        });
        fast.push({ seen, req });
        resolve();
      });
      req.on('error', () => undefined);
    });
  };
  for (let i = 0; i < clients - slow; i++) await open(i, false);
  for (let i = 0; i < slow; i++) await open(i, true);

  const rate = o.ratePerSec ?? 500;
  for (let n = 1; n <= total; n++) {
    sentAt.set(n, performance.now());
    const r = await fetch(`${base}/internal/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nook-internal': secret },
      body: JSON.stringify({
        t: 'agent.state',
        agent: `student:load${n}`,
        state: n % 2 ? 'studying' : 'idle',
      }),
    });
    if (!r.ok) throw new Error(`ingest failed: ${r.status}`);
    if (n % 25 === 0) await new Promise((res) => setTimeout(res, (25 / rate) * 1000));
  }
  // slow clients get a flood of fat events (about 24 MB) so socket buffers fill and the bounded queue overflows
  const fat = 'x'.repeat(16 * 1024);
  for (let n = 0; n < 2500; n++)
    await fetch(`${base}/internal/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nook-internal': secret },
      body: JSON.stringify({
        t: 'agent.message',
        from: 'dean',
        to: 'commons',
        taskId: 'load',
        kind: 'flood',
        shared: [fat],
      }),
    });
  await new Promise((r) => setTimeout(r, 400));

  let missing = 0;
  let outOfOrder = 0;
  let duplicates = 0;
  for (const c of fast) {
    const set = new Set(c.seen);
    duplicates += c.seen.length - set.size;
    for (let n = 1; n <= total; n++) if (!set.has(n)) missing++;
    for (let i = 1; i < c.seen.length; i++)
      if ((c.seen[i] as number) < (c.seen[i - 1] as number)) outOfOrder++;
  }
  lat.sort((a, b) => a - b);
  const q = (p: number) =>
    Math.round((lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0) * 100) / 100;
  const health = await j(base, '/v1/health').catch(() => ({}));
  for (const c of fast) c.req.destroy();
  for (const s of slowSocks) s.destroy();
  await new Promise((r) => setTimeout(r, 200));
  const after = (await j(base, '/v1/health').catch(() => ({ subscribers: null }))).subscribers as
    number | null;
  const subsBeforeClose = (health as { subscribers?: number }).subscribers ?? null;
  const slowDropped =
    subsBeforeClose === null ? 0 : Math.max(0, slow - (subsBeforeClose - fast.length));
  const report: LoadReport = {
    clients,
    slowClients: slow,
    events: total,
    missing,
    outOfOrder,
    duplicates,
    slowDropped,
    p50Ms: q(0.5),
    p99Ms: q(0.99),
    heapGrowthMb: Math.round(((process.memoryUsage().heapUsed - heap0) / 1024 / 1024) * 10) / 10,
    subscribersAfter: after,
    subscribersBeforeClose: subsBeforeClose,
  };
  if (own) await own.stop();
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runLoad({
    ...(process.env.HUB_URL ? { url: process.env.HUB_URL } : {}),
    ...(process.env.SECRET ? { secret: process.env.SECRET } : {}),
    clients: Number(process.env.CLIENTS) || 50,
    events: Number(process.env.EVENTS) || 500,
  });
  console.log(JSON.stringify(r, null, 2));
  const ok =
    r.missing === 0 &&
    r.outOfOrder === 0 &&
    r.duplicates === 0 &&
    r.subscribersAfter === 0 &&
    r.slowDropped === r.slowClients;
  process.exit(ok ? 0 : 1);
}
