// Registers the Sendblue provider's probes with the shared Integration Health registry (GET /v1/connections/health).
// The four chain ids already declared by health/checks/sendblue.ts are replaced by real probes; four more are added.
// A live check without credentials is `blocked` with the exact env names, never a fake pass.
import { registerHealthCheck, type HealthCtx, type HealthResult } from '../../health/registry';
import { healthReport, type HealthCheck } from './health';

const MAP: [sharedId: string, ownId: string, order: number][] = [
  ['sendblue_outbound', 'outbound_probe', 80],
  ['sendblue_delivery', 'last_delivery_status', 81],
  ['sendblue_inbound', 'inbound_seen', 82],
  ['sendblue_thread', 'thread_mapped_to_web_thread', 83],
  ['sendblue_configured', 'sendblue_configured', 84],
  ['sendblue_webhook_secret', 'webhook_secret_set', 85],
  ['sendblue_webhook_url', 'webhook_reachable_url', 86],
  ['sendblue_allowlist', 'allowlist_configured', 87],
];

const toResult = (c: HealthCheck): HealthResult => ({
  label: c.label,
  status: c.status,
  reason: c.reason.slice(0, 400),
  ...(c.status === 'pass'
    ? {}
    : { fix: { label: c.fix.slice(0, 60), to: '/squad/connections#imessage' } }),
  ...(c.missingEnv?.length ? { missingEnv: c.missingEnv } : {}),
  mode: 'sendblue',
});

type Link = { status: HealthCheck['status']; reason: string; missingEnv?: string[] };
type Alt = { sendblue?: { health?: () => Promise<Record<string, Link>> | Record<string, Link> } };
const ALT_KEY: Record<string, string> = {
  sendblue_outbound: 'outbound',
  sendblue_delivery: 'delivery',
  sendblue_inbound: 'inbound',
  sendblue_thread: 'thread',
};

export function registerSendblueProviderChecks(): void {
  // The Demo/Fixture bridge is its own link: a demo pass, never a claim about the real Sendblue connection.
  registerHealthCheck('imessage_demo_bridge', 'sendblue', 88, (ctx: HealthCtx): HealthResult => {
    const on = ctx.deps.imessageInfo?.provider === 'fake' && !!ctx.deps.imessageInfo.demo;
    if (on)
      return {
        label: 'iMessage Demo bridge',
        status: 'pass',
        mode: 'demo',
        reason:
          'Demo/Fixture bridge is on: a scripted transport, nothing leaves this machine. This is NOT the real Sendblue connection.',
      };
    return {
      label: 'iMessage Demo bridge',
      status: 'warn',
      mode: 'demo',
      reason: ctx.deps.config.production
        ? 'The demo bridge is not available in a production config.'
        : 'The demo bridge is off (optional). Start it on Connections to test the whole loop without Sendblue credentials.',
      ...(ctx.deps.config.production
        ? {}
        : { fix: { label: 'Start the demo bridge', to: '/squad/connections#imessage' } }),
    };
  });
  for (const [sharedId, ownId, order] of MAP)
    registerHealthCheck(sharedId, 'sendblue', order, async (ctx: HealthCtx) => {
      // an alternative provider that exposes deps.sendblue.health() (the contract of health/checks/sendblue.ts) wins
      const alt = (ctx.deps as Alt).sendblue?.health;
      const key = ALT_KEY[sharedId];
      if (alt && key) {
        const l = (await alt())[key]!;
        return {
          label: sharedId,
          status: l.status,
          reason: l.reason,
          ...(l.missingEnv?.length ? { missingEnv: l.missingEnv } : {}),
        };
      }
      const r = await healthReport(ctx.deps);
      const c = r.checks.find((x) => x.id === ownId);
      return c ? toResult(c) : { label: ownId, status: 'fail', reason: 'check missing' };
    });
}
