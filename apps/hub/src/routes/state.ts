// STUB from the lead: the owning sub-agent replaces this file wholesale, keeping the exported names and signatures.
import { Hono } from 'hono';
import type { HubApp, HubDeps, HubEnv } from '../types';
export function createStateRoutes(_deps: HubDeps): HubApp {
  return new Hono<HubEnv>();
}
