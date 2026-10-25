import { startHub } from './server';
import { attachChatEngine } from './chat/engine';
import { getObs, instrumentLlm } from './observability';
import { agentUrlsFromEnv } from './wire';
import { attachIMessage } from './imessage/wire';

const hub = await startHub();
const obs = getObs(hub.deps)!;
obs.installProcessHandlers();
const agentUrls = agentUrlsFromEnv();
hub.deps.confirms.setAgentUrls(agentUrls);
hub.deps.tripSvc.setAgentUrls(agentUrls);
// carry the correlation id to the agents and the bot's internal server
obs.propagateTo([...Object.values(agentUrls), process.env.BOT_URL]);
// One process serves the village and the chat: one resilient model (Gemini, or the demo model when there is no key
// or the credits are gone), one brain, one mastery store. GET /v1/status says which one is answering.
// The model is wrapped once so every call (village ports and chat skills) lands in the llm metrics.
const chat = await attachChatEngine(hub, {
  realPorts: true,
  agentUrls,
  instrument: (llm) =>
    instrumentLlm(llm, obs.metrics, undefined, (reason) =>
      hub.deps.log.warn(`llm: serving the demo model (${reason}); GET /v1/status shows why`),
    ),
});
// iMessage bridge: off unless IMESSAGE_ENABLED=1 plus an allowlist (docs/imessage.md).
const imessage = await attachIMessage(hub);
const st = hub.deps.runtime!.llm();
hub.deps.log.info(
  `ports: ${hub.deps.runtime!.ports()}, llm: ${st.llm}${st.reason ? ` (${st.reason})` : ''}; GET /v1/status shows why`,
);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void Promise.resolve(imessage?.stop())
      .then(() => chat.stop())
      .then(() => hub.stop())
      .then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
