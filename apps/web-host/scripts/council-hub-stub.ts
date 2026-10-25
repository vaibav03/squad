// Demo hub for council-flow.mjs when `COUNCIL_HUB=stub`: the seeded hub with stub ports and no chat engine, so the first
// council request builds the deterministic demo service (docs/council-api.md section 6). Not part of any build.
import { startHub } from '../../hub/src/server';

const hub = await startHub();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void hub.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  });
}
