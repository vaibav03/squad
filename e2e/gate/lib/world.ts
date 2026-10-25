// Builds a GateCtx: one fixture world (one squad, one group thread), the LLM mode switch, the live budget guard and
// browser actors. Everything is closed again in dispose().
import type { Browser } from '@playwright/test';
import type { World } from './fakes/client';
import { ctl } from './fakes/ctl';
import { LiveBudget, liveMode } from './live';
import { webActor } from './hub';
import type { GateCtx } from './ctx';

export async function makeCtx(
  browser: Browser,
  opts: { b?: boolean; kind?: 'fresh' | 'journey'; actors?: boolean } = {},
): Promise<GateCtx> {
  const world = (await ctl.world({ kind: opts.kind ?? 'fresh', b: !!opts.b })) as World;
  const ctx: GateCtx = {
    browser,
    world,
    llm: await liveMode(),
    budget: new LiveBudget(),
    actors: {},
    state: {},
  };
  if (opts.actors !== false) {
    ctx.actors.rhea = await webActor(browser, world.users.rhea);
    ctx.actors.ben = await webActor(browser, world.users.ben);
  }
  return ctx;
}

export async function disposeCtx(c: GateCtx): Promise<void> {
  await c.actors.rhea?.ctx.close().catch(() => undefined);
  await c.actors.ben?.ctx.close().catch(() => undefined);
}
