import { startHub } from './server';
import { resilientLlmFromEnv, wireRealPorts } from './wire';

const hub = await startHub();
const llm = resilientLlmFromEnv(process.env, (reason) =>
  hub.deps.log.warn(`llm: switched to the fake demo model (${reason}); GET /v1/status shows why`),
);
// Real ports (brain, quiz, media) whenever there is a key; FORCE_FAKE_LLM=1 keeps them on the fake model.
const real = Boolean(process.env.GEMINI_API_KEY) || process.env.FORCE_FAKE_LLM === '1';
if (real) {
  await wireRealPorts(hub, { llm });
  hub.deps.log.info(`ports: real (brain, quiz, media), llm: ${llm.status().llm}`);
} else {
  hub.deps.log.info('ports: stubs (GEMINI_API_KEY is not set)');
}
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
