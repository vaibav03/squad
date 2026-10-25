// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LiveConfigProvider } from '../overlays/kit';
import { tripPlanning } from '../pages/trip/fixtures';
import { PlanRedirect, planChatHref } from './redirects';

const group = (id: string, title: string) => ({
  id,
  kind: 'group',
  title,
  private: false,
  members: [],
});
const dm = { id: 'dm:s_ana', kind: 'dm', title: 'Nook', private: true, members: [] };
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function stub(o: { trip: 'ok' | '404'; chats: unknown[] | 'fail' }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/v1/trips'))
        return o.trip === 'ok' ? json({ trip: tripPlanning }) : json({ error: 'not_found' }, 404);
      if (o.chats === 'fail') return Promise.reject(new TypeError('network'));
      return json({ chats: o.chats });
    }),
  );
}
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function mount() {
  render(
    <LiveConfigProvider
      value={{ mode: 'live', hubUrl: 'http://hub.test', token: 't', userId: 'u' }}
    >
      <MemoryRouter initialEntries={['/squad/trips']}>
        <Routes>
          <Route path="/squad/trips" element={<PlanRedirect />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </LiveConfigProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('planChatHref', () => {
  it('builds the chat deep link', () => {
    expect(planChatHref({ groupId: 'group:sq_1', planId: 'trip_1' })).toBe(
      '/squad/chat?group=group%3Asq_1&plan=trip_1',
    );
  });
});

describe('PlanRedirect', () => {
  it('redirects to the single group chat', async () => {
    stub({ trip: 'ok', chats: [dm, group('group:sq_1', 'Squad')] });
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe(
        `/squad/chat?group=group%3Asq_1&plan=${tripPlanning.tripId}&notice=plans`,
      ),
    );
  });
  it('several groups show one link each', async () => {
    stub({ trip: 'ok', chats: [group('group:g1', 'Alpha'), group('group:g2', 'Beta')] });
    mount();
    expect(await screen.findByText('Plans now live in your group chat')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Alpha' }).getAttribute('href')).toBe(
      '/squad/chat?group=group%3Ag1',
    );
    expect(screen.getByRole('link', { name: 'Open Beta' }).getAttribute('href')).toBe(
      '/squad/chat?group=group%3Ag2',
    );
  });
  it('unknown trip shows the migration screen', async () => {
    stub({ trip: '404', chats: [group('group:g1', 'Alpha')] });
    mount();
    expect(await screen.findByRole('link', { name: 'Open Alpha' })).toBeTruthy();
  });
  it('an error shows the migration screen with a chat link', async () => {
    stub({ trip: 'ok', chats: 'fail' });
    mount();
    const a = await screen.findByRole('link', { name: 'Open chat' });
    expect(a.getAttribute('href')).toBe('/squad/chat');
  });
});
