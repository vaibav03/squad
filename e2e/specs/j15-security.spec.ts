import fs from 'node:fs';
import path from 'node:path';
import { HUB, REPO, TMP, WEB } from '../lib/env';
import { actor, api, apiLogin, expect, FAIL_PATTERNS, test } from '../lib/helpers';

function envSecrets(): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  try {
    for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
      const m =
        /^(?:export\s+)?([A-Z0-9_]*(?:KEY|SECRET|TOKEN)[A-Z0-9_]*)\s*=\s*["']?([^"'\s#]+)/.exec(l);
      if (m && m[2]!.length >= 10) out.push({ name: m[1]!, value: m[2]! });
    }
  } catch {
    /* no .env */
  }
  out.push({ name: 'INTERNAL_EVENTS_SECRET(dev)', value: 'dev-internal-secret' });
  return out;
}

test('J15 unauthenticated and forged requests are rejected', async () => {
  const noAuth = await fetch(`${HUB}/internal/events`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  expect([401, 403]).toContain(noAuth.status);
  const bad = await fetch(`${HUB}/internal/events`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json', 'x-nook-internal': 'wrong' },
  });
  expect([401, 403]).toContain(bad.status);
  for (const p of [
    '/v1/squad/state',
    '/v1/me',
    '/v1/tasks',
    '/v1/ledger/task_trip_cabo',
    '/v1/personas',
  ]) {
    const r = await fetch(`${HUB}${p}`);
    expect(r.status, p).toBe(401);
  }
  const sse = await fetch(`${HUB}/v1/squad/stream`);
  expect(sse.status).toBe(401);
  const chat = await fetch(`${HUB}/v1/chat/chats`);
  expect([401, 404]).toContain(chat.status); // 404 until chat/web is merged
  const forged = await fetch(`${HUB}/v1/me`, { headers: { authorization: 'Bearer abc.def' } });
  expect(forged.status).toBe(401);
});

test('J15 CORS does not reflect a foreign origin', async () => {
  const r = await fetch(`${HUB}/v1/status`, { headers: { origin: 'https://evil.example' } });
  expect(r.headers.get('access-control-allow-origin')).not.toBe('https://evil.example');
  expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
  const ok = await fetch(`${HUB}/v1/status`, { headers: { origin: WEB } });
  expect(ok.headers.get('access-control-allow-origin')).toBe(WEB);
});

test('J15 no secrets in responses, bundles, source maps or logs', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  for (const p of [
    '/squad',
    '/squad/village',
    '/squad/setup',
    '/squad/personas',
    '/squad/ledger/task_trip_cabo',
    '/squad/mastery',
  ]) {
    await a.page.goto(p);
    await a.page.waitForTimeout(1200);
  }
  const blob = a.bodies.join('\n') + '\n' + a.assets.join('\n');
  const secrets = envSecrets();
  for (const s of secrets)
    expect(blob.includes(s.value), `${s.name} value appears in a web response`).toBe(false);
  for (const re of FAIL_PATTERNS.secrets) expect(blob, String(re)).not.toMatch(re);
  // source maps
  const maps = [...blob.matchAll(/sourceMappingURL=([^\s*]+)/g)].map((m) => m[1]!).slice(0, 15);
  for (const m of maps) {
    const t = await (await fetch(new URL(m, WEB))).text().catch(() => '');
    for (const s of secrets)
      expect(t.includes(s.value), `${s.name} in source map ${m}`).toBe(false);
  }
  // logs written by the stack
  for (const f of ['stack.log', 'hub-restart.log']) {
    const p = path.join(TMP, f);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    for (const s of secrets.filter((x) => !x.name.includes('dev')))
      expect(t.includes(s.value), `${s.name} in ${f}`).toBe(false);
    for (const re of FAIL_PATTERNS.secrets) expect(t, `${f} ${re}`).not.toMatch(re);
  }
  // another student's token cannot read Ana's private ledger values (sanity of auth scoping)
  const ben = await apiLogin('s_ben');
  expect(await (await api(ben, '/v1/ledger/task_trip_cabo')).text()).not.toMatch(/therapy|\$180/);
  await a.ctx.close();
});
