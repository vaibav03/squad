import { describe, expect, it } from 'vitest';
import {
  CanvasAccessError,
  MAX_PAGES,
  createCanvasClient,
  nextLink,
  parseCanvasJson,
} from '../src/canvas';

const ORIGIN = 'https://canvas.school.test';
type Handler = (url: string) => { status?: number; body?: unknown; link?: string };
function fakeCanvas(h: Handler) {
  const calls: { url: string; credentials?: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, credentials: init?.credentials });
    const r = h(url);
    const status = r.status ?? 200;
    return new Response(status >= 400 ? '{}' : `while(1);${JSON.stringify(r.body ?? [])}`, {
      status,
      headers: r.link ? { Link: r.link } : {},
    });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('canvas client (Nook parity P1-P6)', () => {
  it('P1 strips while(1);', () => {
    expect(parseCanvasJson('while(1);{"a":1}')).toEqual({ a: 1 });
    expect(parseCanvasJson(' while (1) ;[1]')).toEqual([1]);
  });
  it('parses rel=next', () => {
    expect(nextLink('<https://x/a?page=2>; rel="next", <https://x/a?page=9>; rel="last"')).toBe(
      'https://x/a?page=2',
    );
    expect(nextLink(null)).toBeNull();
  });
  it('P6 probe returns the user or null', async () => {
    const ok = fakeCanvas(() => ({ body: { id: 7, name: 'Sam', email: 's@x.test' } }));
    expect(await createCanvasClient(ok.f).probe(ORIGIN)).toEqual({
      origin: ORIGIN,
      canvasUserId: '7',
      name: 'Sam',
      primary_email: 's@x.test',
    });
    expect(ok.calls[0]!.credentials).toBe('include');
    expect(
      await createCanvasClient(fakeCanvas(() => ({ status: 401 })).f).probe(ORIGIN),
    ).toBeNull();
    const boom = (async () => {
      throw new Error('net');
    }) as unknown as typeof fetch;
    expect(await createCanvasClient(boom).probe(ORIGIN)).toBeNull();
  });
  it('P4/P5 collects Nook payload shape with string ids and defaults', async () => {
    const { f } = fakeCanvas((url) => {
      if (url.includes('/courses?'))
        return { body: [{ id: 1, name: 'Bio 101', course_code: 'BIO101' }, { id: 2 }] };
      if (url.includes('/courses/1/assignments'))
        return {
          body: [
            {
              id: 10,
              name: 'Lab 1',
              due_at: '2026-11-01T06:59:00Z',
              html_url: `${ORIGIN}/a/10`,
              description: '<p>x</p>',
            },
            { id: 11 },
          ],
        };
      if (url.includes('/courses/1/files'))
        return {
          body: [
            {
              id: 20,
              display_name: 'wk1.pdf',
              'content-type': 'application/pdf',
              size: 12,
              url: `${ORIGIN}/f/20`,
              updated_at: '2026-10-01T00:00:00Z',
            },
            { id: 21 },
          ],
        };
      return { body: [] };
    });
    const p = await createCanvasClient(f).collect({ origin: ORIGIN, canvasUserId: '7' });
    expect(p.courses).toEqual([
      { id: '1', name: 'Bio 101', course_code: 'BIO101' },
      { id: '2', name: '', course_code: null },
    ]);
    expect(p.assignments[0]).toMatchObject({
      id: '10',
      course_id: '1',
      due_at: '2026-11-01T06:59:00Z',
    });
    expect(p.assignments[1]).toMatchObject({ id: '11', name: '(untitled)', due_at: null });
    expect(p.files[1]).toMatchObject({ id: '21', display_name: 'file', size: null });
    expect(p.canvas_user_id).toBe('7');
  });
  it('P2 follows next up to MAX_PAGES and never leaves the origin', async () => {
    let n = 0;
    const { f } = fakeCanvas((url) => {
      if (url.includes('/courses?')) {
        n++;
        return { body: [{ id: n }], link: `<${ORIGIN}/api/v1/courses?page=${n + 1}>; rel="next"` };
      }
      return { body: [] };
    });
    const p = await createCanvasClient(f).collect({ origin: ORIGIN, canvasUserId: '7' });
    expect(p.courses).toHaveLength(MAX_PAGES);
    const off = fakeCanvas((url) => ({
      body: [{ id: 1 }],
      link: url.includes('/courses?') ? '<https://evil.test/x>; rel="next"' : undefined,
    }));
    await createCanvasClient(off.f).collect({ origin: ORIGIN, canvasUserId: '7' });
    expect(off.calls.every((c) => c.url.startsWith(ORIGIN))).toBe(true);
  });
  it('P3 files 401/403/404 means no files', async () => {
    for (const status of [401, 403, 404]) {
      const { f } = fakeCanvas((url) =>
        url.includes('/files')
          ? { status }
          : url.includes('/courses?')
            ? { body: [{ id: 1, name: 'A' }] }
            : { body: [] },
      );
      const p = await createCanvasClient(f).collect({ origin: ORIGIN, canvasUserId: '7' });
      expect(p.files).toEqual([]);
    }
  });
  it('maps 401 on courses to expired and 429 to rate_limited', async () => {
    const a = createCanvasClient(fakeCanvas(() => ({ status: 401 })).f).collect({
      origin: ORIGIN,
      canvasUserId: '7',
    });
    await expect(a).rejects.toMatchObject({ kind: 'expired' });
    const b = createCanvasClient(
      fakeCanvas((u) => (u.includes('/courses?') ? { body: [{ id: 1 }] } : { status: 429 })).f,
    ).collect({ origin: ORIGIN, canvasUserId: '7' });
    await expect(b).rejects.toBeInstanceOf(CanvasAccessError);
    await expect(b).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});
