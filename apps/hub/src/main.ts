import { startHub } from './server';

const hub = await startHub();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void hub.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
