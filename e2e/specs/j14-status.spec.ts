import { execSync } from 'node:child_process';
import { REPO } from '../lib/env';
import { expect, FAIL_PATTERNS, liveGuard, note, status, test } from '../lib/helpers';

test('J14 /v1/status reflects reality', async () => {
  const s = await status();
  note(`status ${JSON.stringify({ llm: s.llm, demo: s.demo, reason: s.reason, tts: s.tts })}`);
  expect(['gemini', 'fake']).toContain(s.llm);
  expect(s.demo).toBe(s.llm === 'fake');
  if (s.demo) expect(s.notice, 'demo mode needs a visible notice').toBeTruthy();
  expect(JSON.stringify(s)).not.toMatch(/AIza|sk_[0-9a-f]{10}/);
  await liveGuard();
});

test('J14 pnpm run doctor prints a sane report and never a key value', async () => {
  let out = '';
  try {
    out = execSync('pnpm run doctor 2>&1', { cwd: REPO, encoding: 'utf8', timeout: 60_000 });
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? e);
  }
  expect(out.length).toBeGreaterThan(50);
  expect(out).toMatch(/gemini|elevenlabs|key/i);
  for (const re of FAIL_PATTERNS.secrets) expect(out).not.toMatch(re);
});
