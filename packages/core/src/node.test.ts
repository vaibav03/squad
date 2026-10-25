import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig, openMemoryDb } from './node';

describe('openMemoryDb', () => {
  it('has the core schema and is isolated per call', () => {
    const a = openMemoryDb();
    const b = openMemoryDb();
    a.prepare('INSERT INTO students(id,name,handle) VALUES (?,?,?)').run('s_ana', 'Ana', '+1555');
    expect(a.prepare('SELECT count(*) c FROM students').get()).toEqual({ c: 1 });
    expect(b.prepare('SELECT count(*) c FROM students').get()).toEqual({ c: 0 });
    const tables = a.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'students',
        'chats',
        'chat_members',
        'messages',
        'memory',
        'pending_confirms',
      ]),
    );
  });
});

describe('loadConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'squad-cfg-'));
  const file = join(dir, '.env');
  writeFileSync(file, 'GEMINI_API_KEY=abc\nHUB_BASE_URL=http://h:1\nELEVENLABS_API_KEY=\n');

  it('reads .env and applies defaults; real env wins', () => {
    const c = loadConfig({ env: {}, envFile: file });
    expect(c).toMatchObject({
      geminiApiKey: 'abc',
      hubBaseUrl: 'http://h:1',
      dbPath: 'data/squad.db',
      live: false,
    });
    expect(c.elevenLabsApiKey).toBeUndefined();
    expect(loadConfig({ env: { GEMINI_API_KEY: 'zzz' }, envFile: file }).geminiApiKey).toBe('zzz');
  });

  it('never exposes secret values in describeConfig, and rejects a bad url', () => {
    const s = JSON.stringify(
      describeConfig(loadConfig({ env: { INTERNAL_EVENTS_SECRET: 'topsecret' }, envFile: file })),
    );
    expect(s).not.toMatch(/abc|topsecret/);
    expect(() => loadConfig({ env: { HUB_BASE_URL: 'nope' }, envFile: false })).toThrow();
  });
});
