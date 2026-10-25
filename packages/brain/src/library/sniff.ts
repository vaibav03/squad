import { createHash } from 'node:crypto';
import { LIBRARY_LIMITS, LibraryError } from './types';

export type SniffedType = 'pdf' | 'txt' | 'md';

export const MIME: Record<SniffedType, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
};

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Display name: basename only, no control characters, bounded length. Never used as a path. */
export function safeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f<>"|?*:]/g, '').trim();
  const name = base.replace(/^\.+/, '').slice(-120).trim();
  return name || 'upload';
}

const extOf = (name: string): string => /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdfMagic = (b: Uint8Array) => {
  const head = Buffer.from(b.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
};

/** UTF-8 text without NUL bytes; BOM stripped. Returns null when not text. */
export function decodeText(b: Uint8Array): string | null {
  if (b.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

/**
 * Type by content, not by the client's mime. PDF needs the %PDF- magic; txt/md need valid UTF-8 text and a
 * matching extension. pptx (a zip) and every other binary is rejected: export slides to PDF instead.
 */
export function sniffType(bytes: Uint8Array, name: string): SniffedType {
  const ext = extOf(name);
  if (isPdfMagic(bytes)) {
    if (ext === 'pdf') return 'pdf';
    throw new LibraryError('unsupported_type');
  }
  if (isZip(bytes) || ext === 'pdf') throw new LibraryError('unsupported_type');
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    if (decodeText(bytes) === null) throw new LibraryError('unreadable_text');
    return ext === 'txt' ? 'txt' : 'md';
  }
  throw new LibraryError('unsupported_type');
}

/**
 * Raw token scan for active content. Names written with #xx escapes are decoded first.
 * Limitation: tokens inside compressed object streams are not visible to this scan; the parser never
 * executes anything, so those are inert here. The scan keeps scripted files out of the stored copy that
 * squadmates may open in their own viewer.
 */
const UNSAFE = /\/(?:JS|JavaScript|Launch|EmbeddedFile|RichMedia|SubmitForm)(?![A-Za-z0-9])/;
export function scanUnsafePdf(bytes: Uint8Array): boolean {
  const s = Buffer.from(bytes).toString('latin1');
  const decoded = s.replace(/#([0-9A-Fa-f]{2})/g, (_m, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  return UNSAFE.test(decoded);
}

export function assertSize(size: number): void {
  if (size > LIBRARY_LIMITS.maxFileBytes) throw new LibraryError('too_large');
  if (size === 0) throw new LibraryError('empty_file');
}
