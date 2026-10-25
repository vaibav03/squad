// Assertion collector used by every step. It never throws: failures are recorded and decide the step status.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { REPO, SENTINELS, SHOTS } from './config';
import type { AssertionResult } from './types';

/** Raw ids and handles that must not appear in any user-visible text. */
export const RAW_ID_PATTERNS: [string, RegExp][] = [
  ['student id', /\bs_[a-z]{2,}\b/],
  ['squad id', /\bsq_[a-z0-9_]{3,}\b/],
  ['chat id', /\b(?:group|dm):[A-Za-z0-9_-]{3,}/],
  ['hub message id', /\bm_\d{1,}\b/],
  ['chat guid', /iMessage;[+-];[^\s]+/],
  ['phone number', /\+?\d[\d\s().-]{8,}\d/],
  ['hex id', /\b[0-9a-f]{24,}\b/i],
  ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['task id', /\btask_[a-z0-9]{6,}\b/],
];

export class Asserts {
  readonly results: AssertionResult[] = [];
  private readonly trace = process.env.GATE_TRACE === '1';
  private push(r: AssertionResult) {
    this.results.push(r);
    if (this.trace)
      console.log(
        `[${this.stepId}] ${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`,
      );
  }
  readonly evidence: string[] = [];
  readonly notes: string[] = [];
  private shotN = 0;

  constructor(private readonly stepId: string) {}

  ok(name: string, cond: unknown, detail?: string): boolean {
    this.push({ name, pass: !!cond, ...(detail && !cond ? { detail } : {}) });
    return !!cond;
  }
  eq<T>(name: string, actual: T, expected: T): boolean {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    this.push({
      name,
      pass,
      ...(pass
        ? {}
        : { detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` }),
    });
    return pass;
  }
  note(text: string) {
    this.notes.push(text);
  }
  fail(name: string, detail: string) {
    this.push({ name, pass: false, detail });
  }

  /** ids unique and seq strictly increasing */
  ordered(name: string, msgs: { id: string; seq: number }[]) {
    const ids = new Set(msgs.map((m) => m.id));
    const seqs = msgs.map((m) => m.seq);
    const inc = seqs.every((s, i) => i === 0 || s > seqs[i - 1]!);
    this.ok(
      name,
      ids.size === msgs.length && inc,
      `ids=${ids.size}/${msgs.length} seq=${seqs.join(',')}`,
    );
  }

  /** None of `forbidden` may appear in `text`. Reports the surface and the sentinel NAME, never the surrounding text. */
  noLeak(surface: string, text: string, forbidden: string[] = defaultSentinels()) {
    const hit = forbidden.filter((f) => f && text.toLowerCase().includes(f.toLowerCase()));
    this.ok(
      `no sentinel in ${surface}`,
      hit.length === 0,
      `leaked: ${hit.map((h) => h.slice(0, 12) + '...').join(', ')}`,
    );
  }

  /** No raw id, handle, or GUID in text a person reads. */
  noRawIds(surface: string, text: string) {
    const hits = RAW_ID_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
    // the shape of the first match, digits and letters masked, so a false positive can be diagnosed without echoing text
    const shape = RAW_ID_PATTERNS.map(([, re]) => re.exec(text)?.[0])
      .filter((x): x is string => !!x)
      .map((x) => x.replace(/\d/g, '#').replace(/[a-z]/gi, 'x'))
      .slice(0, 2);
    this.ok(
      `no raw ids in ${surface}`,
      hits.length === 0,
      `found: ${hits.join(', ')} shape ${shape.join(' | ')}`,
    );
  }

  /** The surface says honestly whether it is a demo model: demo labelled when llm is fake, never when it is real. */
  modeBadge(surface: string, text: string, llm: 'gemini' | 'fake') {
    const labelled = /\bdemo\b/i.test(text);
    if (llm === 'fake')
      this.ok(`demo label visible on ${surface}`, labelled, 'status says fake but no "Demo" label');
    else
      this.ok(
        `no demo label on ${surface} while llm is real`,
        !labelled,
        'a "Demo" label is shown while llm=gemini',
      );
  }

  async shot(page: Page, name: string): Promise<string> {
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(
      SHOTS,
      `${this.stepId.toLowerCase()}-${String(++this.shotN).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`,
    );
    await page.screenshot({ path: file }).catch(() => undefined);
    const rel = path.relative(REPO, file);
    this.evidence.push(rel);
    return rel;
  }

  get failed(): AssertionResult[] {
    return this.results.filter((r) => !r.pass);
  }
}

export const defaultSentinels = (): string[] => [
  SENTINELS.budget,
  SENTINELS.topic,
  SENTINELS.calTitle,
  SENTINELS.driveHidden,
  SENTINELS.grade,
  SENTINELS.refreshToken,
  SENTINELS.feedSecret,
];
