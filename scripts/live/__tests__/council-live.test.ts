import { describe, expect, it, vi } from 'vitest';
import { main } from '../council-live-proof';

describe('live:council-live (gated)', () => {
  it('refuses without LIVE=1 and spends nothing', async () => {
    vi.stubEnv('LIVE', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main()).toBe(2);
    expect(log.mock.calls.join('\n')).toMatch(/refuses to run: LIVE is not 1/);
    log.mockRestore();
    vi.unstubAllEnvs();
  });
});
