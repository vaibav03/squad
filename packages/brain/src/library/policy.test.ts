import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_DIR } from '../ingest';
import { extractPolicy } from '../ingest/chapters';
import { classifyTopic, extractPolicyLines, policyColumn } from './policy';

const syllabus = readFileSync(join(FIXTURE_DIR, 'syllabus.txt'), 'utf8');

describe('extractPolicyLines', () => {
  it('returns numbered verbatim lines of the committed syllabus with topics', () => {
    const lines = extractPolicyLines(syllabus);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.map((l) => l.n)).toEqual(lines.map((_, i) => i + 1));
    expect(lines.every((l) => l.verbatim === true)).toBe(true);
    const ai = lines.find((l) => l.text.startsWith('Using an AI assistant'));
    expect(ai?.topic).toBe('ai');
    expect(lines.find((l) => l.text.startsWith('Submitting work'))?.topic).toBe('ai');
    expect(lines.find((l) => l.text.startsWith('Weekly homework'))?.topic).toBe('homework');
  });
  it('is the same text hwpolicy quotes (extractPolicy)', () => {
    const lines = extractPolicyLines(syllabus);
    expect(policyColumn(syllabus, lines)).toBe(extractPolicy(syllabus));
    expect(policyColumn('Nothing relevant here.', [])).toBe('Nothing relevant here.');
  });
  it('classifies', () => {
    expect(classifyTopic('You may work with classmates.')).toBe('collaboration');
    expect(classifyTopic('Plagiarism is a violation.')).toBe('integrity');
    expect(classifyTopic('Office hours are on Thursday.')).toBe('other');
  });
  it('property: every line is an exact trimmed line of the input, in order, nothing invented', () => {
    const word = fc.constantFrom(
      'homework',
      'AI',
      'ChatGPT',
      'late work',
      'exam',
      'lecture',
      'grade',
      'plagiarism',
      'the',
      'is',
      'allowed',
      'Dr. Rivera',
      'quiz',
    );
    const line = fc
      .tuple(
        fc.array(word, { minLength: 0, maxLength: 8 }),
        fc.constantFrom('', ' ', '\t', '  '),
        fc.constantFrom('', ' ', '\t'),
      )
      .map(([w, a, b]) => `${a}${w.join(' ')}${b}`);
    fc.assert(
      fc.property(fc.array(line, { maxLength: 30 }), fc.constantFrom('\n', '\r\n'), (ls, eol) => {
        const text = ls.join(eol);
        const source = text.split(/\r?\n/).map((l) => l.trim());
        const out = extractPolicyLines(text);
        let cursor = 0;
        for (const o of out) {
          expect(o.text).toBe(o.text.trim());
          const at = source.indexOf(o.text, cursor);
          expect(at).toBeGreaterThanOrEqual(cursor); // exact line, original order
          cursor = at + 1;
        }
        // nothing dropped that matches, nothing added
        expect(out.map((o) => o.text)).toEqual(source.filter((l) => l && extractPolicy(l) === l));
      }),
      { numRuns: 300 },
    );
  });
});
