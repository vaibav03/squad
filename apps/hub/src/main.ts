import { startHub } from './server';
import { getObs, instrumentLlm } from './observability';
import { agentUrlsFromEnv, resilientLlmFromEnv, wireRealPorts } from './wire';

const hub = await startHub();
const obs = getObs(hub.deps)!;
obs.installProcessHandlers();
const llm = instrumentLlm(
  resilientLlmFromEnv(
    process.env,
    (reason) =>
      hub.deps.log.warn(`llm: serving the fake demo model (${reason}); GET /v1/status shows why`),
    () => hub.deps.log.info('llm: real Gemini is back'),
  ),
  obs.metrics,
);
// Real ports (brain, quiz, media) whenever there is a key; FORCE_FAKE_LLM=1 keeps them on the fake model.
const real = Boolean(process.env.GEMINI_API_KEY) || process.env.FORCE_FAKE_LLM === '1';
if (real) {
  await wireRealPorts(hub, { llm, agentUrls: agentUrlsFromEnv() });
  hub.deps.log.info(`ports: real (brain, quiz, media), llm: ${llm.status().llm}`);
} else {
  hub.deps.log.info('ports: stubs (GEMINI_API_KEY is not set)');
}
hub.deps.confirms.setAgentUrls(agentUrlsFromEnv());
// carry the correlation id to the agents and the bot's internal server
obs.propagateTo([...Object.values(agentUrlsFromEnv()), process.env.BOT_URL]);
hub.deps.runtime = {
  llm: () => llm.status(),
  tts: () => real && Boolean(process.env.ELEVENLABS_API_KEY),
  ports: () => (real ? 'real' : 'stub'),
};
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void hub.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
