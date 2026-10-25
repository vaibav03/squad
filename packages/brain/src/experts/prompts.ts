import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Prompts live in versioned .md files (reviewed like code). The first `<!-- prompt: ... -->` line is stripped. */
export function loadPrompt(dirUrl: string, name: string): string {
  const raw = readFileSync(join(dirname(fileURLToPath(dirUrl)), 'prompts', name), 'utf8');
  return raw.replace(/^<!--[^>]*-->\s*\n/, '').trimEnd();
}

export function promptVersion(dirUrl: string, name: string): string {
  const raw = readFileSync(join(dirname(fileURLToPath(dirUrl)), 'prompts', name), 'utf8');
  return /^<!--\s*prompt:\s*([^>]*?)\s*-->/.exec(raw)?.[1] ?? 'unversioned';
}
