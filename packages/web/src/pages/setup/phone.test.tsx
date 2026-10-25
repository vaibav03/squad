// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SetupPage from './index';
import { SquadProvider } from '../../shell/context';

const HUB = 'http://hub.test';
type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply | Reply[]> = {};
const sent: { path: string; body: unknown }[] = [];

beforeEach(() => {
  replies = { 'GET /v1/imessage/link': { body: { links: [] } } };
  sent.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.replace(HUB, '');
      const method = init?.method ?? 'GET';
      if (method === 'POST') sent.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
      const r = replies[`${method} ${path}`];
      const one = Array.isArray(r) ? r.shift() : r;
      if (!one) return Promise.resolve(new Response('{}', { status: 404 }));
      return Promise.resolve(new Response(JSON.stringify(one.body), { status: one.status ?? 200 }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(mode: 'live' | 'mock' = 'live') {
  return render(
    <MemoryRouter initialEntries={['/squad/setup/phone']}>
      <SquadProvider
        hubUrl={HUB}
        mode={mode}
        session={{ userId: 'u1', name: 'Ana', token: 't', live: true }}
      >
        <Routes>
          <Route path="/squad/setup/:step" element={<SetupPage />} />
        </Routes>
      </SquadProvider>
    </MemoryRouter>,
  );
}

const enterPhone = () => {
  fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '4155550134' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
};

describe('phone step (real linking)', () => {
  it('dev delivery: shows the labelled dev code and links only after verify', async () => {
    replies['POST /v1/me/phone/start'] = {
      body: {
        ok: true,
        challengeId: 'pc_1',
        to: '•••• 0134',
        delivery: 'dev',
        deliveryLabel: 'Code shown here (dev)',
        devCode: '123456',
        devCodeLabel: 'Dev code (HUB_DEV_LOGIN): not sent to your phone',
      },
    };
    replies['POST /v1/me/phone/verify'] = {
      body: { ok: true, verified: true, hint: '•••• 0134' },
    };
    mount();
    expect(screen.queryByText(/Demo step/)).toBeNull();
    enterPhone();
    await waitFor(() => expect(screen.getByText('Code shown here (dev)')).toBeTruthy());
    expect(screen.getByTestId('phone-dev-code').textContent).toBe('123456');
    expect(sent[0]).toEqual({ path: '/v1/me/phone/start', body: { phone: '+14155550134' } });
    expect(screen.queryByText('Phone linked')).toBeNull();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByText('Phone linked')).toBeTruthy());
    expect(sent[1]).toEqual({
      path: '/v1/me/phone/verify',
      body: { challengeId: 'pc_1', code: '123456' },
    });
  });

  it('wrong code keeps the step unlinked and says so', async () => {
    replies['POST /v1/me/phone/start'] = {
      body: {
        ok: true,
        challengeId: 'pc_1',
        to: 'x',
        delivery: 'imessage',
        deliveryLabel: 'Code sent by iMessage',
      },
    };
    replies['POST /v1/me/phone/verify'] = {
      status: 400,
      body: { error: { code: 'code_invalid', triesLeft: 4 } },
    };
    mount();
    enterPhone();
    await waitFor(() => expect(screen.getByText('Code sent by iMessage')).toBeTruthy());
    expect(screen.queryByTestId('phone-dev-code')).toBeNull();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(screen.getByText(/That code is not right\. 4 tries left/)).toBeTruthy(),
    );
    expect(screen.queryByText('Phone linked')).toBeNull();
  });

  it('delivery unavailable is stated honestly and never advances', async () => {
    replies['POST /v1/me/phone/start'] = {
      body: {
        ok: false,
        delivery: 'unavailable',
        deliveryLabel: 'Code delivery unavailable',
        message: 'code delivery unavailable: the iMessage bridge is not configured on this hub',
        to: 'x',
      },
    };
    mount();
    enterPhone();
    await waitFor(() =>
      expect(screen.getAllByText(/Code delivery unavailable/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/bridge is not configured/)).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    expect(screen.queryByText('Phone linked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
  });

  it('an already linked phone shows as linked from server state', async () => {
    replies['GET /v1/imessage/link'] = { body: { links: [{ hint: '•••• 0134', linkedAt: 1 }] } };
    mount();
    await waitFor(() => expect(screen.getByText('Phone linked')).toBeTruthy());
  });

  it('without a live hub it does not pretend to link', () => {
    mount('mock');
    expect(screen.getByText('Live hub needed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send code' })).toBeNull();
  });
});
