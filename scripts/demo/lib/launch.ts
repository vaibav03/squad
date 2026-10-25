import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths';

export interface ScriptInfo {
  exists: boolean;
  script?: string;
  /** true when the script is missing or just echoes "not implemented". */
  stub: boolean;
}

/** Look at a workspace package.json script (e.g. apps/hub `start`). */
export function inspectScript(pkgDir: string, name: string, root = ROOT): ScriptInfo {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, pkgDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.[name];
    if (!script) return { exists: false, stub: true };
    return { exists: true, script, stub: /not implemented/i.test(script) };
  } catch {
    return { exists: false, stub: true };
  }
}

/** Port declared in a dev script such as `vite --port 5180`. */
export function portFromScript(script: string | undefined): number | undefined {
  const m = script ? /--port[ =](\d{2,5})/.exec(script) : null;
  return m ? Number(m[1]) : undefined;
}

export function portFromUrl(url: string): number | undefined {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : undefined;
  } catch {
    return undefined;
  }
}

export function villageUrl(webBase: string, name: string): string {
  return `${webBase.replace(/\/+$/, '')}/squad/village?replay=${encodeURIComponent(name)}`;
}
