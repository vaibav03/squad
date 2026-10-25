/// <reference types="vite/client" />
import type { AdapterModule, SceneModule } from '../world/api';

/** Pure: stable sort by order (default 100), de-duplicate ids (last wins), drop skipped ids. */
export function orderModules(mods: SceneModule[], skip: readonly string[] = []): SceneModule[] {
  const byId = new Map<string, SceneModule>();
  for (const m of mods)
    if (m && typeof m.id === 'string' && typeof m.create === 'function' && !skip.includes(m.id))
      byId.set(m.id, m);
  return [...byId.values()]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.order ?? 100) - (b.m.order ?? 100) || a.i - b.i)
    .map((x) => x.m);
}

// Exactly the discovery contract in docs/village-api.md. Missing files are simply absent from the glob.
const moduleFiles = import.meta.glob<{ default: SceneModule | SceneModule[] }>([
  '../scenes/module.ts',
  '../mesh-view/module.ts',
  '../cutscene/module.ts',
  '../a11y/module.ts',
  '../inspector/module.ts',
  '../council/module.ts',
  '../overlay-bridge/module.ts',
  '../motion/module.ts',
]);
const adapterFiles = import.meta.glob<{
  default?: AdapterModule;
  createAdapter?: AdapterModule['createAdapter'];
}>('../adapter/module.ts');

export async function loadModules(
  skip: readonly string[] = [],
  log: (m: string, e?: unknown) => void = () => {},
): Promise<SceneModule[]> {
  const out: SceneModule[] = [];
  for (const [path, load] of Object.entries(moduleFiles)) {
    try {
      const m = (await load()).default;
      if (Array.isArray(m)) out.push(...m);
      else if (m) out.push(m);
    } catch (e) {
      log(`module file ${path} failed to load`, e);
    }
  }
  return orderModules(out, skip);
}

export async function loadAdapter(
  log: (m: string, e?: unknown) => void = () => {},
): Promise<AdapterModule | undefined> {
  for (const load of Object.values(adapterFiles)) {
    try {
      const mod = await load();
      const a =
        mod.default ?? (mod.createAdapter ? { createAdapter: mod.createAdapter } : undefined);
      if (a?.createAdapter) return a;
    } catch (e) {
      log('adapter failed to load', e);
    }
  }
  return undefined;
}
