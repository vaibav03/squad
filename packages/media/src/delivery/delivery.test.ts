import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { probeDurationMs, run, toneWav } from '../tts/audio';
import {
  assertSendable,
  gifFromFrames,
  prepareAudioAttachment,
  preparePngAttachment,
  toOutbound,
} from './index';

const frame = (c: [number, number, number]) =>
  sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: c[0], g: c[1], b: c[2], alpha: 1 },
    },
  })
    .png()
    .toBuffer();

describe('delivery', () => {
  it('wav -> m4a audio/mp4 with duration', async () => {
    const d = await mkdtemp(join(tmpdir(), 'dl-'));
    await writeFile(join(d, 'a.wav'), toneWav(1000, 300));
    const a = await prepareAudioAttachment(join(d, 'a.wav'));
    expect(a.mime).toBe('audio/mp4');
    expect(await probeDurationMs(a.path)).toBeGreaterThan(800);
  });

  it('gif has the right frame count and upscaled size, and is deterministic', async () => {
    const d = await mkdtemp(join(tmpdir(), 'dl-'));
    const frames = [
      await frame([200, 0, 0]),
      await frame([0, 200, 0]),
      await frame([0, 0, 200]),
      await frame([200, 200, 0]),
    ];
    const g1 = await gifFromFrames(frames, { outDir: d, scale: 4, fps: 8 });
    const g2 = await gifFromFrames(frames, { outDir: d, scale: 4, fps: 8 });
    expect(g1.path).toBe(g2.path);
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_read_frames,width,height',
      '-of',
      'csv=p=0',
      g1.path,
    ]);
    expect(stdout.trim()).toBe('64,64,4');
    expect(g1.mime).toBe('image/gif');
  });

  it('png prep validates and strips', async () => {
    const d = await mkdtemp(join(tmpdir(), 'dl-'));
    const p = join(d, 'x.png');
    await sharp({ create: { width: 2000, height: 100, channels: 3, background: '#fff' } })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'x' } } })
      .toFile(p);
    const out = await preparePngAttachment(p, { maxWidth: 1000 });
    const m = await sharp(out.path).metadata();
    expect(m.width).toBe(1000);
    expect(m.exif).toBeUndefined();
    await writeFile(join(d, 'bad.png'), 'nope');
    await expect(preparePngAttachment(join(d, 'bad.png'))).rejects.toThrow();
  });

  it('assertSendable rejects outside dir, missing and empty', async () => {
    const d = await mkdtemp(join(tmpdir(), 'dl-'));
    await writeFile(join(d, 'ok.txt'), 'x');
    await writeFile(join(d, 'empty.txt'), '');
    await expect(assertSendable(join(d, 'ok.txt'), d)).resolves.toBeUndefined();
    await expect(assertSendable('/etc/hosts', d)).rejects.toThrow(/outside/);
    await expect(assertSendable(join(d, '../x'), d)).rejects.toThrow();
    await expect(assertSendable(join(d, 'empty.txt'), d)).rejects.toThrow(/empty/);
    await expect(assertSendable(join(d, 'nope'), d)).rejects.toThrow();
  });

  it('toOutbound', () => {
    expect(
      toOutbound({ chatId: 'c', text: 't', attachments: [{ path: '/a', mime: 'x' }] }).attachments,
    ).toHaveLength(1);
  });
});
