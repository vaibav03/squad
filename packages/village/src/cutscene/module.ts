import type { ModuleInstance, SceneModule, SceneCommand as WorldCommand } from '../world/api';
import type { SceneCommand } from '../adapter';
import { preloadTripAssets } from './assets';
import { createTripCutscene, createTripDoor } from './trip';
import type { TripCutscene, TripDoor } from './trip';

/**
 * Trip cutscene module (order 300). `playTrip` plays it once per task: road scrolls, the van drives off,
 * the Trip door pops open. Any key or tap skips. Calm mode and reduced motion get a static card.
 */
const mod: SceneModule = {
  id: 'cutscene',
  order: 300,
  preload(ctx, load) {
    preloadTripAssets(ctx, load);
  },
  create(ctx): ModuleInstance {
    let running: TripCutscene | undefined;
    let door: TripDoor | undefined;
    let detach: (() => void) | undefined;
    const played = new Set<string>();
    // once per trip, also across reloads and the web "Watch in the village" hand-off (sessionStorage may be blocked)
    const flagKey = (taskId: string) => `squad:trip-played:${taskId}`;
    const wasPlayed = (taskId: string): boolean => {
      try {
        return globalThis.sessionStorage?.getItem(flagKey(taskId)) === '1';
      } catch {
        return false;
      }
    };
    const markPlayed = (taskId: string): void => {
      try {
        globalThis.sessionStorage?.setItem(flagKey(taskId), '1');
      } catch {
        /* storage blocked: the in-memory set still guards this mount */
      }
    };

    const onSkip = () => running?.skip();
    const attachSkip = () => {
      if (typeof document === 'undefined') return;
      document.addEventListener('keydown', onSkip, true);
      document.addEventListener('pointerdown', onSkip, true);
      detach = () => {
        document.removeEventListener('keydown', onSkip, true);
        document.removeEventListener('pointerdown', onSkip, true);
      };
    };

    return {
      onCommand(raw: WorldCommand) {
        const cmd = raw as unknown as SceneCommand;
        if (cmd.type !== 'playTrip') return;
        const key = `${cmd.squadId}:${cmd.taskId}`;
        // once per trip: replays, loops and seeks never replay it, they only make sure the door is there
        if (played.has(key) || ctx.registry.get(`tripPlayed:${key}`) || wasPlayed(cmd.taskId)) {
          door ??= createTripDoor(ctx, cmd.taskId);
          door.show({ pop: false });
          return;
        }
        played.add(key);
        ctx.registry.set(`tripPlayed:${key}`, true);
        markPlayed(cmd.taskId);
        door ??= createTripDoor(ctx, cmd.taskId);
        running?.destroy();
        running = createTripCutscene(ctx, {
          onDoor: () => door?.show({ pop: true }),
          onEnd: () => {
            detach?.();
            detach = undefined;
          },
        });
        attachSkip();
      },
      update(_t, dt) {
        running?.update(dt);
        if (running?.done) {
          running.destroy();
          running = undefined;
        }
      },
      destroy() {
        detach?.();
        running?.destroy();
        door?.destroy();
      },
    };
  },
};
export default mod;
