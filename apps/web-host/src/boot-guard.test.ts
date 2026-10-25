// @vitest-environment jsdom
// The static boot guard in index.html: before React mounts a slow connection must see progress, not a false failure,
// and a bundle that really never starts must end in a visible error with Retry.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const guard = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]!)
  .find((s) => s.includes('Squad boot guard'))!;
const markup = body
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace('%SQUAD_BUILD%', 'abc')
  .replace('%SQUAD_BUILD%', 'abc');

const visible = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel);
  return !!el && !el.hidden;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = markup;
  new Function(guard)();
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('index.html boot guard', () => {
  it('starts with a visible "Starting Squad" and no error', () => {
    expect(visible('.sq-boot__msg')).toBe(true);
    expect(visible('.sq-boot__slow')).toBe(false);
    expect(visible('.sq-boot__err')).toBe(false);
  });

  it('at 8 s says "Still loading Squad..." with Retry but is not an error', () => {
    vi.advanceTimersByTime(8100);
    expect(visible('.sq-boot__slow')).toBe(true);
    expect(document.querySelector('.sq-boot__slow')!.textContent).toMatch(/Still loading Squad/);
    expect(document.querySelector('.sq-boot__slow button')).toBeTruthy();
    expect(visible('.sq-boot__err')).toBe(false);
  });

  it('at 45 s with no app it shows "Squad did not start" and Retry', () => {
    vi.advanceTimersByTime(45100);
    expect(visible('.sq-boot__err')).toBe(true);
    expect(visible('.sq-boot__slow')).toBe(false);
    expect(document.title).toBe('Squad did not start');
  });

  it('once React has replaced the boot state nothing is shown or changed', () => {
    document.getElementById('root')!.innerHTML = '<main>app</main>';
    vi.advanceTimersByTime(60000);
    expect(document.getElementById('root')!.textContent).toBe('app');
  });
});
