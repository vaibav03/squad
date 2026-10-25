import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listPersonas } from '../personas/index.js';
import { buildPersonaGif, probeGif } from './buildGif.js';
import { gifPath } from './index.js';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('persona GIFs (needs ffmpeg)', () => {
  it('builds a small, looping, integer-scaled GIF from frames, deterministically', () => {
    const a = buildPersonaGif({ id: 'cubbie', anim: 'talk', out: '/tmp/squad-gif-test-a.gif' });
    const b = buildPersonaGif({ id: 'cubbie', anim: 'talk', out: '/tmp/squad-gif-test-b.gif' });
    const pr = probeGif(a);
    expect(pr.frames).toBe(8);
    expect(pr.width % 8).toBe(0);
    expect(pr.width).toBe(pr.height);
    expect(statSync(a).size).toBeLessThan(400 * 1024);
    expect(statSync(a).size).toBe(statSync(b).size);
  });

  it('every committed hello.gif/talk.gif exists and is under 400KB', () => {
    for (const p of listPersonas()) {
      for (const k of ['hello', 'talk'] as const) {
        const f = gifPath(p.id, k);
        expect(existsSync(f), `${f} missing (run build:gifs)`).toBe(true);
        expect(statSync(f).size).toBeLessThan(400 * 1024);
      }
    }
  });
});
