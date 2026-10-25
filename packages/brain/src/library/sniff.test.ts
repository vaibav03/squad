import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../ingest';
import { LibraryError } from './types';
import { safeName, scanUnsafePdf, sniffType } from './sniff';
import { buildTextPdf } from './testpdf';

const enc = (s: string) => new TextEncoder().encode(s);
const code = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof LibraryError ? e.code : 'other';
  }
  return undefined;
};

describe('sniffType', () => {
  it('goes by content, not by the client mime', () => {
    expect(sniffType(buildTextPdf(['hello world']), 'a.pdf')).toBe('pdf');
    expect(sniffType(enc('# Notes\nhello'), 'a.md')).toBe('md');
    expect(sniffType(enc('plain text'), 'a.txt')).toBe('txt');
  });
  it('rejects a PDF renamed to .txt, text renamed .pdf, pptx/zip and binaries', () => {
    expect(code(() => sniffType(buildTextPdf(['x y z']), 'a.txt'))).toBe('unsupported_type');
    expect(code(() => sniffType(enc('hello there'), 'a.pdf'))).toBe('unsupported_type');
    expect(code(() => sniffType(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'deck.pptx'))).toBe(
      'unsupported_type',
    );
    expect(code(() => sniffType(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'deck.txt'))).toBe(
      'unsupported_type',
    );
    expect(code(() => sniffType(new Uint8Array([1, 2, 0, 3]), 'a.txt'))).toBe('unreadable_text');
    expect(code(() => sniffType(enc('<script>x</script>'), 'a.html'))).toBe('unsupported_type');
  });
});

describe('scanUnsafePdf', () => {
  it('flags JS, JavaScript, Launch and EmbeddedFile, also hex-escaped names', () => {
    for (const extra of [
      '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
      '/Names << /JavaScript 5 0 R >>',
      '/OpenAction << /S /Launch /F (cmd.exe) >>',
      '/Names << /EmbeddedFile 5 0 R >>',
      '/OpenAction << /S /#4A#61vaScript /JS (x) >>',
    ])
      expect(scanUnsafePdf(buildTextPdf(['hello there'], extra))).toBe(true);
  });
  it('lets plain PDFs, an OpenAction without script and every committed fixture through', () => {
    expect(scanUnsafePdf(buildTextPdf(['hello there']))).toBe(false);
    expect(scanUnsafePdf(buildTextPdf(['hello'], '/OpenAction [4 0 R /Fit]'))).toBe(false);
    const dir = join(FIXTURE_DIR, 'openstax');
    for (const f of readdirSync(dir)) expect(scanUnsafePdf(readFileSync(join(dir, f)))).toBe(false);
  });
});

describe('safeName', () => {
  it('keeps a basename only', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('C:\\x\\notes.txt')).toBe('notes.txt');
    expect(safeName('a\u0000b<c>.md')).toBe('abc.md');
    expect(safeName('...')).toBe('upload');
  });
});
