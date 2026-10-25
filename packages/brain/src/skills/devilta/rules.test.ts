import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEMO_PLANS } from './demo';
import {
  clip,
  feedbackLeaks,
  isDevilTaRequest,
  judgeAnswer,
  mentionsScore,
  parseDevilTa,
  parseLineRefs,
  renderLines,
  validateGenerated,
  type Generated,
  type Planted,
} from './rules';

const CTX =
  '[stats.pdf p.1] The mean is the sum of the values divided by the count. The standard deviation is the square root of the variance. [stats.pdf p.2] The median is the middle value of the sorted data.';

const LINES = [
  'The mean is the sum of the values divided by the count.',
  'The median is the middle value of the sorted data.',
  'The standard deviation is the square of the variance.',
  'A larger standard deviation means the data are more spread out.',
];
const PLANTED: Planted = { lines: LINES, errorLine: 2, keywords: ['square'] };

const good = (o: Partial<Generated> = {}): Generated => ({
  lines: LINES,
  errorLine: 2,
  errorKeywords: ['square'],
  whatIsWrong: 'It is the square root of the variance, not the square.',
  correct: 'The standard deviation is the square root of the variance.',
  cite: {
    file: 'stats.pdf',
    page: 1,
    quote: 'standard deviation is the square root of the variance',
  },
  ...o,
});

describe('trigger', () => {
  it.each([
    "@cubbie devil's TA ch3 gradient descent",
    '@cubbie devils ta',
    '@cubbie devil TA on sampling',
    '@cubbie devil’s teaching assistant please',
    '@cubbie find my mistake',
    '@cubbie find the mistake ch2',
    '@cubbie spot the error',
    'can you catch my mistake',
  ])('matches %s', (t) => expect(isDevilTaRequest(t)).toBe(true));

  it.each([
    'lol',
    'the devil is in the details',
    'my TA is mean',
    'can you find my keys',
    'find my phone',
    'spot the difference',
    'the devil wears prada',
  ])('does not match %s', (t) => expect(isDevilTaRequest(t)).toBe(false));
});

describe('parseDevilTa', () => {
  it('reads chapter and topic', () => {
    expect(parseDevilTa("@cubbie devil's TA ch3 gradient descent")).toEqual({
      chapter: 'ch3',
      topic: 'gradient descent',
    });
    expect(parseDevilTa('@cubbie devils ta chapter 12 on the normal distribution')).toEqual({
      chapter: 'ch12',
      topic: 'normal distribution',
    });
    expect(parseDevilTa('@cubbie find my mistake')).toEqual({ topic: '' });
    expect(parseDevilTa('hello')).toBeUndefined();
  });
  it('bounds the topic length', () => {
    const p = parseDevilTa(`devil's TA ${'x'.repeat(500)}`)!;
    expect(p.topic.length).toBeLessThanOrEqual(120);
  });
});

describe('validateGenerated', () => {
  it('accepts a good plan with a verified cite', () => {
    const v = validateGenerated(good(), CTX);
    expect(v.ok && v.citeOk).toBe(true);
  });
  it('strips model numbering from lines', () => {
    const v = validateGenerated(good({ lines: LINES.map((l, i) => `${i + 1}. ${l}`) }), CTX);
    expect(v.ok && v.plan.lines).toEqual(LINES);
  });
  it('a cite that is not on that page is struck (ok, but citeOk=false, no cite kept)', () => {
    for (const cite of [
      { file: 'stats.pdf', page: 2, quote: 'standard deviation is the square root' }, // wrong page
      { file: 'stats.pdf', page: 1, quote: 'invented sentence about nothing' },
      { file: 'other.pdf', page: 1, quote: 'the mean is the sum' },
    ]) {
      const v = validateGenerated(good({ cite }), CTX);
      expect(v.ok && !v.citeOk && v.plan.cite === undefined).toBe(true);
    }
    const none = validateGenerated(good({ cite: undefined }), CTX);
    expect(none.ok && !none.citeOk).toBe(true);
  });
  it('rejects wrong line counts', () => {
    expect(validateGenerated(good({ lines: LINES.slice(0, 2), errorLine: 1 }), CTX)).toEqual({
      ok: false,
      reason: 'line_count',
    });
    const nine = Array.from({ length: 9 }, (_, i) => `Line number ${i} says something fine.`);
    expect(validateGenerated(good({ lines: nine }), CTX)).toEqual({
      ok: false,
      reason: 'line_count',
    });
  });
  it('rejects an error line out of range', () => {
    for (const errorLine of [-1, 4, 99])
      expect(validateGenerated(good({ errorLine }), CTX)).toEqual({
        ok: false,
        reason: 'error_line_range',
      });
  });
  it('rejects when no error keyword appears in the planted line', () => {
    expect(validateGenerated(good({ errorKeywords: ['photosynthesis'] }), CTX)).toEqual({
      ok: false,
      reason: 'keyword_missing',
    });
    // a keyword that is only in another line does not count
    expect(validateGenerated(good({ errorKeywords: ['median'] }), CTX)).toEqual({
      ok: false,
      reason: 'keyword_missing',
    });
    // the singular field works too, and unmatched keywords are dropped
    const v = validateGenerated(good({ errorKeywords: ['nope', 'square'] }), CTX);
    expect(v.ok && v.plan.keywords).toEqual(['square']);
    expect(
      validateGenerated(good({ errorKeywords: undefined, errorKeyword: 'square' }), CTX).ok,
    ).toBe(true);
  });
  it('rejects a line identical to its correction, and empty corrections', () => {
    expect(validateGenerated(good({ correct: LINES[2]! }), CTX)).toEqual({
      ok: false,
      reason: 'same_as_correction',
    });
    expect(validateGenerated(good({ correct: ' ' }), CTX)).toEqual({
      ok: false,
      reason: 'no_correction',
    });
  });
  it('rejects public text that gives the error away', () => {
    const lines = [...LINES];
    lines[2] = `${lines[2]} (this is wrong)`;
    expect(validateGenerated(good({ lines }), CTX).ok).toBe(false);
  });
  it('the demo bank satisfies the same contract', () => {
    for (const d of DEMO_PLANS) {
      const v = validateGenerated(
        {
          lines: d.lines,
          errorLine: d.errorLine,
          errorKeywords: d.keywords,
          whatIsWrong: d.whatIsWrong,
          correct: d.correct,
        },
        '',
      );
      expect(v.ok).toBe(true);
    }
  });
});

describe('parseLineRefs', () => {
  it.each([
    ['line 3', [3]],
    ['3', [3]],
    ['step 3', [3]],
    ['#3', [3]],
    ['Line #3 is wrong', [3]],
    ['the third line', [3]],
    ['3rd line', [3]],
    ["it's 3", [3]],
    ['lines 2 and 3', [2, 3]],
    ['line 9', []],
    ['line 0', []],
    ['it takes 3 hours', []],
    ['@cubbie 3', [3]],
  ] as const)('%s', (t, want) => expect(parseLineRefs(t, 4)).toEqual(want));
});

describe('judgeAnswer (pure)', () => {
  it('the right line number always hits, in any phrasing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 }),
        fc.constantFrom(
          'line {n}',
          '{n}',
          'step {n}',
          '#{n}',
          'it is line {n}',
          'I think {n}.',
          'Line #{n} is wrong',
        ),
        (errorLine, tpl) => {
          const lines = Array.from(
            { length: 8 },
            (_, i) => `claim${i} alpha${i} beta${i} gamma${i}`,
          );
          const p: Planted = { lines, errorLine, keywords: [`beta${errorLine}`] };
          expect(judgeAnswer(tpl.replace('{n}', String(errorLine + 1)), p)).toBe('hit');
        },
      ),
    );
  });
  it('a different valid line number misses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        fc.constantFrom('line {n}', '{n}', 'step {n}', '#{n}'),
        (errorLine, other, tpl) => {
          fc.pre(errorLine !== other);
          const lines = Array.from(
            { length: 8 },
            (_, i) => `claim${i} alpha${i} beta${i} gamma${i}`,
          );
          const p: Planted = { lines, errorLine, keywords: [`beta${errorLine}`] };
          expect(judgeAnswer(tpl.replace('{n}', String(other + 1)), p)).toBe('miss');
        },
      ),
    );
  });
  it('a quoted span of the error line hits', () => {
    expect(judgeAnswer('"standard deviation is the square of the variance"', PLANTED)).toBe('hit');
    expect(judgeAnswer('I think the part about the square of the variance is off', PLANTED)).toBe(
      'hit',
    );
    expect(judgeAnswer('it says standard deviation is the square', PLANTED)).toBe('hit');
  });
  it('a keyword alone hits; a quote from another line does not', () => {
    expect(judgeAnswer('it is the square thing', PLANTED)).toBe('hit');
    expect(judgeAnswer('"the median is the middle value of the sorted data"', PLANTED)).toBe(
      'near',
    );
  });
  it('wrong number plus a quote of the error line still hits (the quote wins)', () => {
    expect(judgeAnswer('line 1, no wait, the square of the variance', PLANTED)).toBe('hit');
  });
  it('wrong number and a keyword that lives in the line they cited stays a miss', () => {
    const p: Planted = {
      lines: ['Alpha uses square roots here.', 'Beta is fine.', 'Gamma squares things badly.'],
      errorLine: 2,
      keywords: ['squares'],
    };
    expect(judgeAnswer('line 1 square roots', p)).toBe('miss');
  });
  it('ambiguous replies are near', () => {
    for (const r of ['?', 'idk', 'something is off', 'maybe the second half', 'hmm the data']) {
      expect(['near', 'miss']).toContain(judgeAnswer(r, PLANTED));
    }
    expect(judgeAnswer('something is off', PLANTED)).toBe('near');
    expect(judgeAnswer('', PLANTED)).toBe('near');
  });
  it('is deterministic', () => {
    fc.assert(fc.property(fc.string(), (s) => judgeAnswer(s, PLANTED) === judgeAnswer(s, PLANTED)));
  });
  it('never hits on text that shares nothing with the error line and names no line', () => {
    fc.assert(
      fc.property(fc.uuid(), (u) => {
        expect(judgeAnswer(`zq${u.replace(/-/g, 'x')}`, PLANTED)).toBe('near');
      }),
    );
  });
});

describe('feedbackLeaks', () => {
  const full = {
    ...PLANTED,
    whatIsWrong: 'It is the square root of the variance.',
    correct: 'The standard deviation is the square root of the variance.',
  };
  it('flags the location, keywords, the correction and score words', () => {
    expect(feedbackLeaks('Look at line 3 again.', full)).toBe(true);
    expect(feedbackLeaks('Look at the third line.', full)).toBe(true);
    expect(feedbackLeaks('Check the square.', full)).toBe(true);
    expect(feedbackLeaks('It is the square root of the variance.', full)).toBe(true);
    expect(feedbackLeaks('You earn a point for that.', full)).toBe(true);
    expect(feedbackLeaks('', full)).toBe(true);
  });
  it('lets a neutral nudge through', () => {
    expect(feedbackLeaks('Read each line slowly and tell me which one bothers you.', full)).toBe(
      false,
    );
    expect(feedbackLeaks('Line 1 looks fine to me.', full)).toBe(false);
  });
});

describe('small helpers', () => {
  it('renders numbered public lines and clips', () => {
    expect(renderLines(['a', 'b'])).toBe('1. a\n2. b');
    expect(clip('x'.repeat(700), 600)).toHaveLength(600);
    expect(clip('short', 600)).toBe('short');
  });
  it('detects score wording', () => {
    expect(mentionsScore('you got 3 points')).toBe(true);
    expect(mentionsScore('xp up')).toBe(true);
    expect(mentionsScore('Caught it: line 3.')).toBe(false);
  });
});
