import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths';

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). No interpolation. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1] as string] = v;
  }
  return out;
}

export const ENV_FILE = path.join(ROOT, '.env');

/** .env values, overridden by the real environment. Returns the file's existence too. */
export function loadEnv(file = ENV_FILE): { env: NodeJS.ProcessEnv; fileExists: boolean } {
  let fileVars: Record<string, string> = {};
  let fileExists = false;
  try {
    fileVars = parseDotEnv(fs.readFileSync(file, 'utf8'));
    fileExists = true;
  } catch {
    /* no .env */
  }
  const env: NodeJS.ProcessEnv = { ...fileVars };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== '') env[k] = v;
  return { env, fileExists };
}
