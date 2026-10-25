import { startHub } from './server';
import { attachChatEngine } from './chat/engine';

const hub = await startHub();
const chat = await attachChatEngine(hub, { realPorts: true });
const st = hub.deps.chat.status();
hub.deps.log.info(
  st.demo
    ? 'ports: stubs for the village; chat runs the demo model (see GET /v1/status)'
    : 'ports: real (brain, quiz, media); chat runs on Gemini',
  { llm: st.llm, tts: st.tts },
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
