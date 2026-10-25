import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface VoiceStore {
  get(key: string): string | undefined;
  set(key: string, voiceId: string): void;
  all(): Record<string, string>;
}

export class MemoryVoiceStore implements VoiceStore {
  constructor(private readonly m: Record<string, string> = {}) {}
  get = (k: string) => this.m[k];
  set = (k: string, v: string) => void (this.m[k] = v);
  all = () => ({ ...this.m });
}

/** Saved voiceIds on disk (atomic write). Student picks use the key `student:<id>`. */
export class JsonVoiceStore implements VoiceStore {
  private m: Record<string, string>;
  constructor(private readonly path: string) {
    try {
      this.m = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    } catch {
      this.m = {};
    }
  }
  get = (k: string) => this.m[k];
  set = (k: string, v: string) => {
    this.m[k] = v;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.m, null, 2) + '\n');
    renameSync(tmp, this.path);
  };
  all = () => ({ ...this.m });
}
