import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLiveStream, type EventSourceLike } from './live-client';
import { mockSnapshot } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

function fakeSource() {
  const handlers: Record<string, (e: MessageEvent) => void> = {};
  const src: EventSourceLike & { urls?: string } = {
    addEventListener: (t, fn) => void (handlers[t] = fn),
    close: vi.fn(),
    onerror: null,
  };
  return { src, handlers };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('openLiveStream', () => {
  it('uses a stream token, validates every frame, drops bad ones, reports errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ st: 'tok' }), { status: 200 })),
    );
    const { src, handlers } = fakeSource();
    let url = '';
    const events: unknown[] = [];
    const onError = vi.fn();
    openLiveStream(
      { hubUrl: 'http://hub.test/', token: 'bearer' },
      'ld_abcdefghijkl',
      { onEvent: (e) => events.push(e), onError },
      (u) => ((url = u), src),
    );
    await tick();
    expect(url).toBe('http://hub.test/v1/live/ld_abcdefghijkl/stream?st=tok');
    handlers.live!({
      data: JSON.stringify({ k: 'snapshot', snapshot: mockSnapshot() }),
    } as MessageEvent);
    handlers.live!({ data: JSON.stringify({ k: 'caption', turnId: 't1' }) } as MessageEvent); // invalid
    handlers.live!({ data: 'not json' } as MessageEvent);
    handlers.live!({
      data: JSON.stringify({ k: 'caption', turnId: 't1', speaker: 'tutor', delta: 'hi' }),
    } as MessageEvent);
    expect(events).toHaveLength(2);
    src.onerror!(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(src.close).toHaveBeenCalled();
  });
});
