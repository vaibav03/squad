import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import type { Check } from '../lib/types';

/**
 * Hub + bot + web chat API in demo-off mode on a real Llm: ask a doubt through POST /v1/chat/send and look for a cited reply.
 * Written against the chat/web branch (apps/hub/src/chat); SKIPs until that lands on main.
 */
export const e2eCheck: Check = {
  id: 8,
  name: 'end to end: hub + bot + web chat, demo-off, cited answer',
  needs: ['gemini'],
  estimate: { calls: 5, tokens: 9000 },
  async run(ctx, t) {
    const engine = path.join(ctx.root, 'apps/hub/src/chat/engine.ts');
    if (!fs.existsSync(engine)) {
      t.skip('chat API', 'apps/hub/src/chat is not on this branch yet (chat/web); merge it, then this check boots the hub with attachChatEngine and asks through /v1/chat/send');
      return;
    }
    const hubMod = (await import(pathToFileURL(path.join(ctx.root, 'apps/hub/src/server.ts')).href)) as { startHub: (o: unknown) => Promise<{ url: string; stop(): Promise<void> }> };
    const engMod = (await import(pathToFileURL(engine).href)) as { attachChatEngine: (h: unknown, o: unknown) => Promise<{ stop?: () => Promise<void> | void }> };
    const replayDir = mkdtempSync(path.join(os.tmpdir(), 'live-hub-'));
    cpSync(path.join(ctx.root, 'packages/core/fixtures/sample-replay.json'), path.join(replayDir, 'sample.json'));
    const hub = await hubMod.startHub({
      config: { port: 0, baseUrl: 'http://localhost:0', internalSecret: 'live-secret', authSecret: 'live-auth', seed: true, sim: false, production: false, logLevel: 'silent', replayDir },
    });
    let handle: { stop?: () => Promise<void> | void } | undefined;
    try {
      handle = await engMod.attachChatEngine(hub, { real: ctx.llm, env: { ...ctx.env, FORCE_FAKE_LLM: '' }, envFile: false, realPorts: true });
      const url = hub.url;
      const j = async (p: string, init?: RequestInit) => {
        const r = await ctx.fetch(url + p, init);
        return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
      };
      await t.step('status says real model, not demo', async () => {
        const s = await j('/v1/status');
        if (s.body.demo !== false || s.body.llm !== 'gemini') throw new Error(`status ${JSON.stringify(s.body).slice(0, 200)}`);
        return 'llm=gemini demo=false';
      });
      let token = '';
      await t.step('dev login as s_ana', async () => {
        const r = await j('/v1/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ studentId: 's_ana' }) });
        token = String(r.body.token ?? '');
        if (!token) throw new Error(`no token (HTTP ${r.status})`);
        return 'token issued';
      });
      await t.step('doubt through the chat API gets a cited, grounded answer', async () => {
        const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        const chatId = 'group:sq_demo';
        const sent = await j('/v1/chat/send', { method: 'POST', headers: auth, body: JSON.stringify({ chatId, text: '@cubbie what does a z-score measure?' }) });
        if (sent.status !== 202) throw new Error(`send HTTP ${sent.status}`);
        const deadline = ctx.now() + 90_000;
        let reply = '';
        while (ctx.now() < deadline) {
          await ctx.sleep(2000);
          const h = await j(`/v1/chat/history?chatId=${encodeURIComponent(chatId)}`, { headers: auth });
          const all = JSON.stringify(h.body);
          const msgs = (Object.values(h.body).find(Array.isArray) ?? []) as { sender?: { kind?: string }; text?: string }[];
          const bot = msgs.filter((m) => m.sender?.kind === 'persona');
          if (bot.length) {
            reply = bot[bot.length - 1]!.text ?? all;
            break;
          }
        }
        if (!reply) throw new Error('no persona reply within 90 s');
        if (/not in the materials/i.test(reply)) throw new Error(`refused an answerable question: ${reply.slice(0, 160)}`);
        if (!/\.pdf\s*p\.\s*\d+/i.test(reply)) throw new Error(`reply has no file p.N citation: ${reply.slice(0, 200)}`);
        return reply.replace(/\s+/g, ' ').slice(0, 200);
      });
    } finally {
      await handle?.stop?.();
      await hub.stop();
    }
  },
};
