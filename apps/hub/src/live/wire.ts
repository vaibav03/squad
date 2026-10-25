// Builds the live service for a hub: real clients when a key exists, FakeLive otherwise, grounding through the
// council's brain when the real ports are wired (fixture course otherwise), takeaways through the hub's model.
import type { Brain } from '@squad/brain';
import type { Llm } from '@squad/core';
import { GeminiLive } from './gemini-client';
import { FakeLive } from './fake-client';
import { liveLimitsFromEnv } from './env';
import type { EngineDeps } from './engine';
import { createBrainGrounder, createFakeGrounder } from './grounder';
import { createLiveService, type LiveService } from './service';
import { createLlmTakeaways, heuristicBuilder } from './takeaways';
import type { HubDeps } from '../types';

/** Set by the real-ports wiring; absent on a stub hub. */
export interface LiveWiring {
  brain?: Brain;
  courseId: () => string;
  llm?: Llm;
}

export function liveServiceFor(deps: HubDeps): LiveService {
  if (deps.live) return deps.live;
  const env = process.env;
  const w = deps.liveWiring;
  const grounder = w?.brain ? createBrainGrounder(w.brain, w.courseId) : createFakeGrounder();
  const realTakeaways = w?.llm ? createLlmTakeaways(w.llm) : heuristicBuilder;
  const engine: EngineDeps = {
    now: () => deps.now(),
    clients: (kind) => (kind === 'gemini' ? new GeminiLive() : new FakeLive()),
    grounder,
    takeaways: (demo) => (demo ? heuristicBuilder : realTakeaways),
    limits: liveLimitsFromEnv(env),
    hasKey: !!env.GEMINI_API_KEY,
    forceFake: env.FORCE_FAKE_LIVE === '1',
    setTimer: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return () => clearTimeout(t);
    },
    village: (e) => void deps.ingest.village(e),
  };
  return (deps.live = createLiveService(engine));
}
