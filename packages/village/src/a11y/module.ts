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
    const me = ctx.me ?? '';
    const slots = ctx.layout.slots;
    const places = slots
      .filter(
        (sl) =>
          sl.kind === 'chapter-house' ||
          sl.kind === 'landmark' ||
          sl.kind === 'mastery-board' ||
          (sl.kind === 'student-home' && sl.id !== `home-${me}`),
      )
      .map((sl) => ({ id: sl.id, name: sl.label }));
    const feed = createAgentFeed({
      me,
      agents: ctx.agents
        .list()
        .filter((a) => !a.hidden)
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      places,
    });
    ctx.registry.set('a11yFeed', feed);
    // The world has one polite live region ('announce'). Assertive text goes there too and is
    // additionally published in registry 'a11yAssertive' for hosts that own an assertive region.
    const offAnn = feed.onAnnounce((a) => {
      if (a.politeness === 'assertive') ctx.registry.set('a11yAssertive', a.text);
      ctx.bus.emit('announce', a.text);
    });
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
