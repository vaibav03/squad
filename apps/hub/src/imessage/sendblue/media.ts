// Outbound attachments for Sendblue: `media_url` must be a public https URL that ends in the file extension, and
// Sendblue does not support query-string signed URLs. So the signature and expiry live IN THE PATH:
//   /v1/imessage/media/<fileId>.<expiryS>.<sig>.<ext>
// fileId is a random id (the file path stays on the server), sig = HMAC(key, fileId.expiryS), links expire in minutes.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';

export const MEDIA_TTL_S = 15 * 60;
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

export interface MediaSigner {
  /** A public URL for a local file (hub-served, signed, expiring), or undefined for a type Sendblue cannot take. */
  urlFor(path: string, publicUrl: string): string | undefined;
  /** Validates a URL tail and returns the file stream; undefined for anything wrong or expired. */
  open(tail: string): { stream: ReadableStream; mime: string; size: number } | undefined;
}

export function createMediaSigner(key: string, now: () => number): MediaSigner {
  const files = new Map<string, { path: string; exp: number }>();
  const sign = (id: string, exp: number) =>
    createHmac('sha256', key).update(`${id}.${exp}`).digest('hex').slice(0, 32);
  return {
    urlFor(path, publicUrl) {
      const ext = extname(path).slice(1).toLowerCase();
      if (!MIME[ext]) return undefined;
      const t = Math.floor(now() / 1000);
      for (const [k, v] of files) if (v.exp < t) files.delete(k);
      const id = randomBytes(12).toString('hex');
      const exp = t + MEDIA_TTL_S;
      files.set(id, { path, exp });
      return `${publicUrl.replace(/\/+$/, '')}/v1/imessage/media/${id}.${exp}.${sign(id, exp)}.${ext}`;
    },
    open(tail) {
      const m = /^([0-9a-f]{24})\.(\d{9,12})\.([0-9a-f]{32})\.([a-z0-9]{2,5})$/.exec(tail);
      if (!m) return undefined;
      const [, id, expS, sig, ext] = m as unknown as [string, string, string, string, string];
      const exp = Number(expS);
      const good = Buffer.from(sign(id, exp));
      const got = Buffer.from(sig);
      if (good.length !== got.length || !timingSafeEqual(good, got)) return undefined;
      if (exp < Math.floor(now() / 1000)) return undefined;
      const f = files.get(id);
      if (!f || !MIME[ext]) return undefined;
      try {
        const size = statSync(f.path).size;
        return {
          stream: Readable.toWeb(createReadStream(f.path)) as unknown as ReadableStream,
          mime: MIME[ext]!,
          size,
        };
      } catch {
        return undefined;
      }
    },
  };
}
