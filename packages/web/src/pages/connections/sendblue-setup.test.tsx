// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImessageCardView } from './ImessageCard';

const NAMES = [
  'SENDBLUE_API_KEY',
  'SENDBLUE_API_SECRET',
  'SENDBLUE_FROM_NUMBER',
  'SENDBLUE_WEBHOOK_SECRET',
];
const info = (o = {}) => ({
  provider: 'sendblue' as const,
  missingEnv: NAMES,
  webhookUrl: 'http://localhost:8788/v1/webhooks/sendblue',
  statusUrl: 'http://localhost:8788/v1/webhooks/sendblue/status',
  secretHeader: 'sb-signing-secret',
  ...o,
});

afterEach(cleanup);

describe('Sendblue setup in the iMessage card', () => {
  it('names every missing env var, the webhook URL to paste and the tunnel note for a local origin', () => {
    render(<ImessageCardView status={{ enabled: false }} now={0} sendblue={info()} />);
    const missing = screen.getByTestId('connections-sendblue-missing').textContent!;
    for (const n of NAMES) expect(missing).toContain(n);
    expect(screen.getByTestId('connections-sendblue-webhook').textContent).toBe(
      'http://localhost:8788/v1/webhooks/sendblue',
    );
    expect(screen.getByTestId('connections-sendblue-tunnel')).toBeTruthy();
    expect(screen.getByTestId('connections-sendblue-steps').textContent).toContain(
      'IMESSAGE_ALLOWED_HANDLES',
    );
  });
  it('configured and public: no missing list and no tunnel note', () => {
    render(
      <ImessageCardView
        status={{ enabled: false }}
        now={0}
        sendblue={info({
          missingEnv: [],
          webhookUrl: 'https://squad.example.com/v1/webhooks/sendblue',
        })}
      />,
    );
    expect(screen.queryByTestId('connections-sendblue-missing')).toBeNull();
    expect(screen.queryByTestId('connections-sendblue-tunnel')).toBeNull();
  });
  it('an older hub (no setup info) renders exactly the old card', () => {
    render(<ImessageCardView status={{ enabled: false }} now={0} />);
    expect(screen.queryByTestId('connections-sendblue')).toBeNull();
  });
});
