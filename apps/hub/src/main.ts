import { startHub } from './server';
import { llmFromEnv, wireRealPorts } from './wire';

const hub = await startHub();
const llm = llmFromEnv();
if (llm) {
  await wireRealPorts(hub, { llm });
  hub.deps.log.info('ports: real (brain, quiz, media)');
} else {
  hub.deps.log.info('ports: stubs (GEMINI_API_KEY is not set)');
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void hub.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
