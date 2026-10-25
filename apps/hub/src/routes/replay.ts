import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ReplayScriptSchema, validateReplay, type ReplayScript } from '@squad/core';
import { Hono } from 'hono';
import { createCallRegistry } from '../calls';
import { filterVillageEvent } from '../filter';
import type { CouncilRunRegistry, FilterCtx, HubApp, HubDeps, HubEnv, Viewer } from '../types';

const NAME = /^[a-z0-9_-]{1,64}$/;

/** Filter a validated replay as its `cast.me` would see it live. Pure; never mutates the input. */
export function filterReplay(script: ReplayScript, deps: HubDeps): ReplayScript {
  const me = script.cast.me;
  const squadId = deps.directory.squadOf(me) ?? '';
  const viewer: Viewer = { studentId: me, squadId, projector: false };
  // call ownership comes from the replay itself, not from live calls
  const calls = createCallRegistry();
  // A recorded council run belongs to the replay's own viewer (`cast.me` asked it, squad-visible), so its
  // `a2a.message` / `council.stage` events are not default-denied for lack of a live run registry.
  const runs = new Set<string>();
  for (const { event } of script.events) {
    if (event.t === 'a2a.message') runs.add(event.msg.correlationId);
    else if (event.t === 'council.stage') runs.add(event.correlationId);
  }
  const councils: CouncilRunRegistry = {
    ownerOf: (id) =>
      runs.has(id)
        ? { askedBy: me, squadId, private: false }
        : deps.filterCtx.councils?.ownerOf(id),
  };
  const ctx: FilterCtx = { ...deps.filterCtx, calls, councils };
  const events: ReplayScript['events'] = [];
  for (const { at, event } of script.events) {
    if (event.t === 'call.start') calls.noteOwner(event.callId, event.student ?? null);
    const out = filterVillageEvent(event, viewer, ctx);
    if (out) events.push({ at, event: out });
  }
  const end = events.at(-1)?.at ?? 0;
  const checkpoints = Object.fromEntries(
    Object.entries(script.checkpoints).map(([k, ms]) => [k, Math.min(ms, end)]),
  );
  return ReplayScriptSchema.parse({ ...script, events, checkpoints });
}

export function createReplayRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const cache = new Map<string, { mtimeMs: number; script: ReplayScript }>();

  function load(name: string): ReplayScript | 'missing' | 'invalid' {
    const file = join(deps.config.replayDir, `${name}.json`);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      return 'missing';
    }
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === mtimeMs) return hit.script;
    const v = validateReplay(readFileSync(file, 'utf8'));
    if (!v.ok) {
      deps.log.error('replay invalid', {
        name,
        paths: v.errors.slice(0, 5).map((e) => e.split(':')[0]),
      });
      return 'invalid';
    }
    cache.set(name, { mtimeMs, script: v.script });
    return v.script;
  }

  r.get('/v1/squad/replays', (c) => {
    let files: string[] = [];
    try {
      files = readdirSync(deps.config.replayDir).filter((f) => f.endsWith('.json'));
    } catch {
      /* no directory yet */
    }
    const replays = files.flatMap((f) => {
      const name = f.slice(0, -5);
      if (!NAME.test(name)) return [];
      const s = load(name);
      return typeof s === 'string'
        ? []
        : [{ name, durationMs: s.events.at(-1)?.at ?? 0, eventCount: s.events.length }];
    });
    c.header('cache-control', 'no-store');
    return c.json({ replays });
  });

  r.get('/v1/squad/replay/:name', (c) => {
    const name = c.req.param('name');
    if (!NAME.test(name)) return c.json({ error: { code: 'not_found' } }, 404);
    const s = load(name);
    if (s === 'missing') return c.json({ error: { code: 'not_found' } }, 404);
    if (s === 'invalid') return c.json({ error: { code: 'internal' } }, 500);
    c.header('cache-control', 'no-store');
    return c.json(filterReplay(s, deps));
  });

  return r;
}
