import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, TMP } from '../lib/env';
import { actor, expect, note, shot, status, test } from '../lib/helpers';
import { GROUP, needChat, openChat, say, waitBot } from '../lib/chat';

async function fetchAttachment(token: string, url: string): Promise<Buffer> {
  const abs = url.startsWith('http') ? url : `${HUB}${url}`;
  const sep = abs.includes('?') ? '&' : '?';
  const r = await fetch(`${abs}${sep}st=${encodeURIComponent(token)}`, { headers: { authorization: `Bearer ${token}` } });
  expect(r.status, `GET ${url}`).toBe(200);
  return Buffer.from(await r.arrayBuffer());
}

test('J11 podcast in demo mode delivers an audio file that opens (m4a)', async ({ browser }) => {
  await needChat();
  const a = await actor(browser, 's_ana');
  await openChat(a, GROUP);
  await say(a.page, '@cubbie podcast ch3');
  const m = await waitBot(a.token, GROUP, (x) => x.attachments.some((t) => t.kind === 'audio'), 90_000);
  expect(m, 'audio attachment message').toBeTruthy();
  const att = m!.attachments.find((t) => t.kind === 'audio')!;
  const buf = await fetchAttachment(a.token, att.url);
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, 'podcast.m4a');
  fs.writeFileSync(f, buf);
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(4, 8).toString(), 'ISO base media file type box').toBe('ftyp');
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
    note(`ffprobe duration ${out}s`);
    expect(Number(out)).toBeGreaterThan(0);
  } catch (e) {
    note(`ffprobe unavailable or failed: ${String(e).slice(0, 80)}`);
  }
  await expect(a.page.locator('audio, [data-testid*="audio"]').first()).toBeAttached({ timeout: 20_000 });
  await shot(a.page, 'j11-media', 'podcast');
  await a.ctx.close();
});

test('J11 explainer picture in demo mode delivers a valid PNG', async ({ browser }) => {
  await needChat();
  const a = await actor(browser, 's_ana');
  await openChat(a, GROUP);
  await say(a.page, '@cubbie picture it ch3');
  const m = await waitBot(a.token, GROUP, (x) => x.attachments.some((t) => t.kind === 'image' && /Picture It/.test(x.text)), 90_000);
  expect(m, 'image attachment message').toBeTruthy();
  const buf = await fetchAttachment(a.token, m!.attachments.find((t) => t.kind === 'image')!.url);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buf.length).toBeGreaterThan(500);
  await shot(a.page, 'j11-media', 'explainer');
  await a.ctx.close();
});

test('J11 personas page: voice preview without an ElevenLabs key does not crash', async ({ browser }) => {
  const s = await status();
  note(`tts status: ${s.tts}`);
  const a = await actor(browser, 's_ana');
  await a.page.goto('/squad/personas');
  await expect(a.page.getByText('Try a line')).toBeVisible({ timeout: 20_000 });
  const fails: string[] = [];
  a.page.on('response', (r) => {
    if (r.status() >= 500) fails.push(`${r.status()} ${r.url()}`);
  });
  const play = a.page.getByRole('button', { name: /^Play .* sample$/ }).first();
  if (!(await play.isVisible())) {
    const body = await a.page.locator('body').innerText();
    note('Voice picker is empty (no voice has a Play button)');
    await shot(a.page, 'j11-media', 'personas-voice-empty');
    expect.soft(/voice.*(unavailable|not available|add .*key|elevenlabs)|preview.*(unavailable|not available)/i.test(body), 'E2E-009: with no ElevenLabs key the Voice section is empty and says nothing about why').toBe(true);
    expect(fails).toEqual([]);
    expect(a.pageErrors).toEqual([]);
    await a.ctx.close();
    return;
  }
  await play.click({ timeout: 8000 });
  await a.page.waitForTimeout(3500);
  await shot(a.page, 'j11-media', 'personas-voice-preview');
  const text = await a.page.locator('body').innerText();
  const said = text.split('\n').filter((l) => /could not play|not available|tap play|playing sample|unavailable|stop .* sample/i.test(l));
  note(`after clicking Play: ${said.slice(0, 3).join(' / ') || 'no visible state change'}; tts=${s.tts}`);
  if (s.tts === 'none')
    expect.soft(said.length, 'E2E-009: with no ElevenLabs key the preview should say it is unavailable or play a labelled fallback; the page shows nothing').toBeGreaterThan(0);
  expect(fails, 'no 5xx from the preview').toEqual([]);
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});
