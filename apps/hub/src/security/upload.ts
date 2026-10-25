/** Upload validation utilities: content is judged by its bytes, never by name or client-declared type. */

export type UploadKind =
  'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'wav' | 'mp3' | 'ogg' | 'webm' | 'ics';
export interface UploadCheck {
  ok: boolean;
  kind?: UploadKind;
  code?: 'empty' | 'too_large' | 'bad_magic' | 'bad_content' | 'bomb';
}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));

/** Sniff the real type from magic numbers. SVG and HTML are deliberately not recognised (script carriers). */
export function sniff(b: Uint8Array): UploadKind | undefined {
  if (b.length >= 4 && ascii(b, 0, '%PDF')) return 'pdf';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return 'wav';
  if (ascii(b, 0, 'GIF8')) return 'gif';
  if (ascii(b, 0, 'OggS')) return 'ogg';
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (ascii(b, 0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'mp3';
  return undefined;
}

export interface UploadPolicy {
  allow: UploadKind[];
  maxBytes: number;
}

export const POLICIES = {
  pdf: { allow: ['pdf'], maxBytes: 50 * 1024 * 1024 },
  image: { allow: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 5 * 1024 * 1024 },
  audio: { allow: ['wav', 'mp3', 'ogg', 'webm'], maxBytes: 10 * 1024 * 1024 },
  ics: { allow: ['ics'], maxBytes: 1024 * 1024 },
} satisfies Record<string, UploadPolicy>;

/** PDF sanity: magic header (checked by the caller) and a cap on object-stream/page-count bombs. */
function checkPdf(b: Uint8Array): UploadCheck['code'] | undefined {
  // Cheap bomb heuristics without parsing: absurd page counts or filter chains.
  const head = Buffer.from(b.subarray(0, Math.min(b.length, 2 * 1024 * 1024))).toString('latin1');
  const counts = [...head.matchAll(/\/Count\s+(\d{1,9})/g)].map((m) => Number(m[1]));
  if (counts.some((n) => n > 5000)) return 'bomb';
  if (/\/Filter\s*\[[^\]]*(\/\w+\s*){5,}\]/.test(head)) return 'bomb'; // 5+ stacked filters
  return undefined;
}

/**
 * .ics: must be UTF-8 text that starts a calendar/event, no NUL bytes, bounded event count and line
 * length (a 1 MB single line or 100k events is a parser DoS, not a calendar).
 */
function checkIcs(b: Uint8Array): UploadCheck['code'] | undefined {
  if (b.includes(0)) return 'bad_content';
  const text = Buffer.from(b).toString('utf8');
  if (!/BEGIN:(VCALENDAR|VEVENT)/i.test(text.slice(0, 4096))) return 'bad_content';
  const events = text.match(/BEGIN:VEVENT/gi)?.length ?? 0;
  if (events > 20_000) return 'bomb';
  let longest = 0;
  for (const line of text.split(/\r?\n/)) if (line.length > longest) longest = line.length;
  if (longest > 16_384) return 'bomb';
  return undefined;
}

export function validateUpload(bytes: Uint8Array, policy: UploadPolicy): UploadCheck {
  if (bytes.length === 0) return { ok: false, code: 'empty' };
  if (bytes.length > policy.maxBytes) return { ok: false, code: 'too_large' };
  const wantsIcs = policy.allow.includes('ics');
  const kind = wantsIcs ? ('ics' as const) : sniff(bytes);
  if (!kind || !policy.allow.includes(kind)) return { ok: false, code: 'bad_magic' };
  const bad = kind === 'pdf' ? checkPdf(bytes) : kind === 'ics' ? checkIcs(bytes) : undefined;
  return bad ? { ok: false, code: bad } : { ok: true, kind };
}

/**
 * Display/storage-safe file name: no path parts, no control or bidi characters, bounded length.
 * Never use the original name to build a filesystem path; use a generated id.
 */
export function safeFileName(raw: string, max = 96): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\u200b-\u200f]/g, '')
    .replace(/^\.+/, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim();
  const out = clean.slice(0, max);
  return out || 'upload';
}

/** Escape text for placement inside HTML (chat bubbles, citation excerpts rendered as HTML). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Allow-list a URL for rendering as a link/image: https only (or same-origin relative path). */
export function safeUrl(u: string): string | null {
  if (u.startsWith('/') && !u.startsWith('//') && !u.includes('\\')) return u;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' ? p.toString() : null;
  } catch {
    return null;
  }
}
