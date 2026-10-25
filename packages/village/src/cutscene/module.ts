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

    /** Starts the cutscene. `force` (host replay / pending hand-off) ignores the played guards. Returns true if it started. */
    const play = (taskId: string, squadId: string, force: boolean): boolean => {
      const key = `${squadId}:${taskId}`;
      // once per trip: replays, loops and seeks never replay it, they only make sure the door is there
      if (!force && (played.has(key) || ctx.registry.get(`tripPlayed:${key}`) || wasPlayed(taskId))) {
        door ??= createTripDoor(ctx, taskId);
        door.show({ pop: false });
        return false;
      }
      played.add(key);
      ctx.registry.set(`tripPlayed:${key}`, true);
      markPlayed(taskId);
      door ??= createTripDoor(ctx, taskId);
      running?.destroy();
      detach?.();
      detach = undefined;
      setFlag('playing');
      running = createTripCutscene(ctx, {
        onDoor: () => door?.show({ pop: true }),
        onEnd: () => {
          detach?.();
          detach = undefined;
          setFlag(undefined);
        },
      });
      attachSkip();
      return true;
    };
    /** Observable for hosts and tests: `data-cutscene="playing"` on <html> while it runs. */
    const setFlag = (v: 'playing' | undefined) => {
      if (typeof document === 'undefined') return;
      if (v) document.documentElement.dataset.cutscene = v;
      else delete document.documentElement.dataset.cutscene;
    };
    // Host hand-off: the web page dispatches `squad:play-trip` once the world is ready and nothing blocks it.
    const onHost = (e: Event) => {
      const d = (e as CustomEvent<{ taskId: string; squadId?: string; force?: boolean; started?: boolean }>)
        .detail;
      if (!d?.taskId) return;
      d.started = play(d.taskId, d.squadId ?? 'squad', d.force !== false);
    };
    if (typeof window !== 'undefined') window.addEventListener('squad:play-trip', onHost);

    return {
      onCommand(raw: WorldCommand) {
        const cmd = raw as unknown as SceneCommand;
        if (cmd.type !== 'playTrip') return;
        // a host that gates the cutscene (web: world ready, nothing modal) plays it itself via `squad:play-trip`
        if (typeof document !== 'undefined' && document.documentElement.dataset.cutsceneHost === 'gate') {
          if (wasPlayed(cmd.taskId)) {
            door ??= createTripDoor(ctx, cmd.taskId);
            door.show({ pop: false });
          }
          return;
        }
        play(cmd.taskId, cmd.squadId, false);
      },
      update(_t, dt) {
        running?.update(dt);
        if (running?.done) {
          running.destroy();
          running = undefined;
        }
      },
      destroy() {
        if (typeof window !== 'undefined') window.removeEventListener('squad:play-trip', onHost);
        setFlag(undefined);
        detach?.();
        running?.destroy();
        door?.destroy();
      },
    };
  },
};
export default mod;
