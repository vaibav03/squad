import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nook parity sentinel scan, repository half: no tracked file may contain a credential-shaped string for the
 * providers Squad integrates (Google OAuth client secret / tokens, Canvas personal access tokens, the extension
 * bearer). The response/log/database half lives in routes/nook-parity.test.ts. Patterns mirror
 * scripts/security/scan.ts; the samples below are assembled at run time so this file never matches itself.
 */
const PATTERNS: [string, RegExp][] = [
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google OAuth access token', /\bya29\.[A-Za-z0-9_-]{20,}/],
  ['Google OAuth refresh token', /\b1\/\/0[A-Za-z0-9_-]{30,}/],
  ['Canvas personal access token', /\b\d{3,6}~[A-Za-z0-9]{40,}\b/],
  ['Squad extension bearer', /\bsqx_[0-9a-f]{18}\.[A-Za-z0-9_-]{20,}/],
];
const pad = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';

describe('secret scan (sentinel patterns)', () => {
  it('the patterns recognise credential-shaped samples', () => {
    const samples = [
      ['GOCSP' + 'X-' + pad, 0],
      ['ya' + '29.' + pad, 1],
      ['1/' + '/0' + pad + pad, 2],
      ['1234' + '~' + pad + pad, 3],
      ['sqx' + '_' + '0123456789abcdef01' + '.' + pad, 4],
    ] as const;
    for (const [text, i] of samples) expect(PATTERNS[i]![1].test(text), PATTERNS[i]![0]).toBe(true);
    expect(PATTERNS.some(([, re]) => re.test('CANVAS-TOKEN-SENTINEL-41ac'))).toBe(false);
  });

  it('no tracked file contains a Google, Canvas or extension credential', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .filter((f) => !/\.(png|jpe?g|gif|webp|pdf|ico|woff2?|ttf|mp3|wav|ogg|zip|glb|gz)$/i.test(f))
      .filter((f) => !/(^|\/)(pnpm-lock\.yaml|scan\.ts|secret-scan\.test\.ts)$/.test(f));
    const hits: string[] = [];
    for (const f of files) {
      const p = resolve(root, f);
      if (!existsSync(p)) continue;
      let text = '';
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${name} in ${f}`);
    }
    expect(hits).toEqual([]);
  });
});
