import type { SceneModule } from '../world/api';
import { createAgentFeed } from './feed';
import type { SceneCommand } from '../adapter';

/**
 * In-canvas side of the text alternative: folds every command into the AgentFeed (stored in
 * ctx.registry under 'a11yFeed' for hosts) and forwards announcements to the world live region.
 */
const mod: SceneModule = {
  id: 'a11y',
  order: 400,
  create(ctx) {
    const feed = createAgentFeed({ me: ctx.me ?? '' });
    ctx.registry.set('a11yFeed', feed);
    const offAnn = feed.onAnnounce((a) => ctx.bus.emit('announce', a.text));
    const offCmd = ctx.bus.on('command', (cmd) =>
      feed.applyCommands([cmd as unknown as SceneCommand]),
    );
    return {
      destroy() {
        offCmd();
        offAnn();
        feed.dispose();
      },
    };
  },
};
export default mod;
