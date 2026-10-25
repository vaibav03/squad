import { startHub } from './server';
import { attachChatEngine } from './chat/engine';
import { agentUrlsFromEnv } from './wire';

const hub = await startHub();
const agentUrls = agentUrlsFromEnv();
hub.deps.confirms.setAgentUrls(agentUrls);
// One process serves the village and the chat: one resilient model (Gemini, or the demo model when there is no key
// or the credits are gone), one brain, one mastery store. GET /v1/status says which one is answering.
const chat = await attachChatEngine(hub, { realPorts: true, agentUrls });
const st = hub.deps.runtime!.llm();
hub.deps.log.info(
  `ports: ${hub.deps.runtime!.ports()}, llm: ${st.llm}${st.reason ? ` (${st.reason})` : ''}; GET /v1/status shows why`,
);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void chat
      .stop()
      .then(() => hub.stop())
      .then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
