import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateReplay, type ReplayScript, type VillageEvent } from '@squad/core';
import type { EventPublisher } from '../types';

export interface Recorder {
  /** Tap this into the bot's publisher (teePublisher). */
  publisher: EventPublisher;
  checkpoint(name: string): void;
  count(): number;
  build(): ReplayScript;
  /** Validates with @squad/core first; throws with every error if invalid, never writes a bad file. */
  write(file: string): ReplayScript;
}

export function createRecorder(opts: {
  name: string;
  cast: { me: string } & Record<string, string>;
  now?: () => number;
  loop?: boolean;
}): Recorder {
  const now = opts.now ?? Date.now;
  const events: { at: number; event: VillageEvent }[] = [];
  const checkpoints: Record<string, number> = {};
  let t0: number | undefined;
  const at = () => {
    const t = now();
    t0 ??= t;
    return Math.max(0, Math.round(t - t0));
  };
  return {
    publisher: {
      async publish(event) {
        const a = Math.max(at(), events.at(-1)?.at ?? 0);
        events.push({ at: a, event: JSON.parse(JSON.stringify(event)) as VillageEvent });
      },
    },
    checkpoint(name) {
      checkpoints[name] = Math.min(at(), events.at(-1)?.at ?? 0);
    },
    count: () => events.length,
    build() {
      const end = events.at(-1)?.at ?? 0;
      return {
        name: opts.name,
        version: 1,
        loop: opts.loop ?? false,
        cast: opts.cast,
        events: [...events],
        checkpoints: { start: 0, ...checkpoints, end },
      };
    },
    write(file) {
      const script = this.build();
      const v = validateReplay(script);
      if (!v.ok) throw new Error(`recording is not a valid replay:\n${v.errors.join('\n')}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(v.script, null, 2)}\n`);
      return v.script;
    },
  };
}
