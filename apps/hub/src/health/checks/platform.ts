import { registerHealthCheck, type HealthCtx, type HealthResult } from '../registry';

export function cubbieReachable(ctx: HealthCtx): HealthResult {
  const label = 'Cubbie reachable';
  if (!ctx.deps.chat.engine)
    return { label, status: 'fail', reason: 'The bot engine is not attached to the chat hub; @cubbie will not answer.', fix: { label: 'Restart the hub', api: 'ops:restart-hub' } };
  return { label, status: 'pass', reason: 'The hub chat has the Cubbie engine attached and answers @cubbie.' };
}

export function modelProvider(ctx: HealthCtx): HealthResult {
  const label = 'Model provider';
  const rt = ctx.deps.runtime;
  if (!rt) return { label, status: 'warn', mode: 'fixture', reason: 'Fixture: no model runtime is attached; answers come from the scripted demo model.' };
  const l = rt.llm();
  if (l.llm === 'real')
    return { label, status: 'pass', mode: 'live', reason: 'Gemini is live and answering.' };
  if (l.probing) return { label, status: 'warn', mode: 'degraded', reason: 'Degraded: checking the model provider.' };
  const why = l.reason ?? 'no_key';
  return {
    label,
    status: 'warn',
    mode: why === 'no_key' || why === 'forced_fake' ? 'fixture' : 'degraded',
    reason:
      why === 'no_key'
        ? 'Fixture: no GEMINI_API_KEY, answers come from the scripted demo model.'
        : why === 'forced_fake'
          ? 'Fixture: FORCE_FAKE_LLM is set, answers come from the scripted demo model.'
          : `Degraded: ${why}. Answers come from the scripted demo model until it recovers.`,
    fix: { label: 'Add or fix the Gemini key', api: 'env:GEMINI_API_KEY' },
  };
}

export async function imessageBridge(ctx: HealthCtx): Promise<HealthResult> {
  const label = 'iMessage bridge';
  const sync = ctx.deps.imessageSync;
  if (!sync) return { label, status: 'warn', mode: 'not connected', reason: 'iMessage: not connected (setup). Chat stays on the web.', fix: { label: 'Set up iMessage', to: '/squad/connections' } };
  const st = await sync.status();
  if (st.fixture) return { label, status: 'warn', mode: 'fixture', reason: 'Fixture transport (no real iMessage).' };
  if (st.transport === 'degraded')
    return { label, status: 'fail', mode: 'degraded', reason: st.watcherDown ? 'Degraded: the Messages watcher stopped.' : 'Degraded: sends to Messages are failing.', fix: { label: 'Check the bridge', to: '/squad/connections' } };
  if (st.dryRun) return { label, status: 'warn', mode: 'dry_run', reason: 'Dry run: messages are routed but nothing is sent to Messages.' };
  return { label, status: 'pass', mode: 'live', reason: 'The iMessage bridge is running.' };
}

export function registerPlatformChecks(): void {
  registerHealthCheck('cubbie_reachable', 'platform', 50, cubbieReachable);
  registerHealthCheck('model_provider', 'platform', 51, modelProvider);
  registerHealthCheck('imessage_bridge', 'platform', 70, imessageBridge);
}
