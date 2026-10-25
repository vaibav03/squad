import fs from 'node:fs';
import path from 'node:path';
import { replayDir } from './paths';

export const REPLAY_NAMES = ['track2', 'track3'] as const;
export type ReplayName = (typeof REPLAY_NAMES)[number];

export function replayFile(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(replayDir(env), `${name}.json`);
}

/** Read a replay file as parsed JSON. `missing` distinguishes "not committed yet" from "unreadable". */
export function readReplayJson(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): { json?: unknown; missing?: boolean; error?: string } {
  const file = replayFile(name, env);
  if (!fs.existsSync(file)) return { missing: true, error: `${file} does not exist` };
  try {
    return { json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `${file}: invalid JSON: ${(e as Error).message}` };
  }
}
