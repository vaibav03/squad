import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). Never logs. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1] as string] = v;
  }
  return out;
}

/** .env values overridden by the real environment (non-empty only). Returns the env, never prints it. */
export function loadEnv(
  file = path.join(ROOT, '.env'),
  base: NodeJS.ProcessEnv = process.env,
): { env: Record<string, string>; fileExists: boolean } {
  let fromFile: Record<string, string> = {};
  let fileExists = false;
  try {
    fromFile = parseDotEnv(fs.readFileSync(file, 'utf8'));
    fileExists = true;
  } catch {
    /* no .env */
  }
  const env: Record<string, string> = { ...fromFile };
  for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== '') env[k] = v;
  return { env, fileExists };
}

const SECRET_KEYS = ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'INTERNAL_EVENTS_SECRET'];

/** Replaces every secret value (and common key shapes) in `text` with a placeholder. */
export function makeRedactor(env: Record<string, string | undefined>): (text: string) => string {
  const secrets = SECRET_KEYS.map((k) => env[k]).filter((v): v is string => !!v && v.length >= 6);
  return (text: string) => {
    let t = text;
    for (const s of secrets) t = t.split(s).join('[redacted]');
    return t
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
      .replace(/\bsk_[0-9a-f]{20,}\b/g, '[redacted]')
      .replace(/([?&](?:key|api_key|xi-api-key)=)[^&\s"']+/gi, '$1[redacted]');
  };
}

export function num(env: Record<string, string | undefined>, key: string, dflt: number): number {
  const v = Number(env[key]);
  return env[key] !== undefined && env[key] !== '' && Number.isFinite(v) && v >= 0 ? v : dflt;
}
