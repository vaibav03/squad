// Sendblue chain: outbound -> delivery -> inbound -> same web thread. The Sendblue provider (feature/sendblue) either
// registers its own probes under these ids (registerHealthCheck replaces by id) or exposes `deps.sendblue.health()`.
// Until it is installed each link is `blocked` (never a fake pass).
import { registerHealthCheck, type HealthCtx, type HealthResult } from '../registry';

export interface SendblueLink {
  status: 'pass' | 'warn' | 'fail' | 'blocked';
  reason: string;
  missingEnv?: string[];
}
export interface SendblueHealth {
  outbound: SendblueLink;
  delivery: SendblueLink;
  inbound: SendblueLink;
  thread: SendblueLink;
}
type WithSendblue = { sendblue?: { health?: () => Promise<SendblueHealth> | SendblueHealth } };

const LINKS = [
  ['sendblue_outbound', 'outbound', 'Sendblue outbound'],
  ['sendblue_delivery', 'delivery', 'Sendblue delivery'],
  ['sendblue_inbound', 'inbound', 'Sendblue inbound'],
  ['sendblue_thread', 'thread', 'Sendblue same web thread'],
] as const;

export function registerSendblueChecks(): void {
  LINKS.forEach(([id, key, label], i) =>
    registerHealthCheck(id, 'sendblue', 80 + i, async (ctx: HealthCtx): Promise<HealthResult> => {
      const probe = (ctx.deps as WithSendblue).sendblue?.health;
      if (!probe)
        return { label, status: 'blocked', mode: 'not installed', reason: 'Sendblue provider not installed on this hub; nothing is sent or received through it.' };
      const h = await probe();
      const l = h[key];
      return {
        label,
        status: l.status,
        reason: l.reason,
        ...(l.missingEnv?.length ? { missingEnv: l.missingEnv } : {}),
        ...(l.status === 'pass' ? {} : { fix: { label: 'Open iMessage setup', to: '/squad/connections' } }),
      };
    }),
  );
}
