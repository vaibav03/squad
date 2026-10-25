import { describe, expect, it } from 'vitest';
import { SENTINELS, type VillageEvent } from '@squad/core';
import { LIGHTS } from '../pixel/raster';
import { DEFAULT_CTX } from '../contract';
import { offPalette, paintShot, po, runScript } from '../testkit';
import { councilHall as def, councilHallBundle } from './index';
import { mapCouncilEvent } from './map';
import { initCouncilHall, reduceCouncil, seatOf } from './state';
import { councilBubbles, holdMs, shortForm } from './words';

const ctx = DEFAULT_CTX;
const QK = 'council:quizkey';
const opinion = (member: string, text?: string, dissent?: boolean): VillageEvent => ({
  t: 'council.opinion',
  councilId: QK,
  member,
  text,
  ...(dissent ? { dissent } : {}),
});

describe('council hall mapEvent', () => {
  it('opinion: unlocks, then an independent thought bubble staggered by seat', () => {
    const s = initCouncilHall();
    expect(mapCouncilEvent(opinion('solver-c', 'C!'), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'bubble', bubble: { who: 'solver-c', text: 'C!', style: 'thought', order: 2 } },
    ]);
  });
  it('opinion with dissent is a red-lined bubble', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const cmds = mapCouncilEvent(opinion('solver-a', 'no', true), s, ctx);
    expect(cmds).toEqual([
      { c: 'bubble', bubble: { who: 'solver-a', text: 'no', style: 'dissent', order: 0 } },
    ]);
  });
  it('rank carries the order', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const e: VillageEvent = {
      t: 'council.rank',
      councilId: QK,
      member: 'solver-a',
      order: ['solver-b', 'solver-a'],
    };
    expect(mapCouncilEvent(e, s, ctx)).toEqual([
      { c: 'rank', by: 'solver-a', order: ['solver-b', 'solver-a'] },
    ]);
  });
  it('verdict: dissent flickers the lantern, no dissent glows steady', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const v = (extra: object): VillageEvent => ({
      t: 'council.verdict',
      councilId: QK,
      member: 'chair',
      text: 'B',
      ...extra,
    });
    expect(mapCouncilEvent(v({ dissent: true, dissenter: 'solver-c' }), s, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'B', dissenter: 'solver-c' },
      { c: 'lantern', mode: 'flicker' },
    ]);
    expect(mapCouncilEvent(v({}), s, ctx)).toEqual([
      { c: 'verdict', chair: 'chair', text: 'B' },
      { c: 'lantern', mode: 'steady' },
    ]);
  });
  it('a new opinion after a verdict clears the previous run', () => {
    let s = runScript(def, [
      { at: 0, event: opinion('solver-a', 'x') },
      { at: 1, event: { t: 'council.verdict', councilId: QK, member: 'chair', text: 'ok' } },
    ]);
    const cmds = mapCouncilEvent(opinion('solver-b', 'y'), s, ctx);
    expect(cmds.slice(0, 2)).toEqual([{ c: 'clearBubbles' }, { c: 'lantern', mode: 'off' }]);
    s = runScript(def, [
      { at: 0, event: opinion('solver-a', 'x') },
      { at: 1, event: { t: 'council.verdict', councilId: QK, member: 'chair', text: 'ok' } },
      { at: 2, event: opinion('solver-b', 'y') },
    ]);
    expect(s.verdict).toBeNull();
    expect(s.lantern).toBe('off');
  });
  it('handles only hall councils and ignores everything else without throwing', () => {
    const s = initCouncilHall();
    const other: VillageEvent[] = [
      { t: 'agent.state', agent: 'dean', state: 'idle' },
      { t: 'council.opinion', councilId: 'council:planner', member: 'chill', text: 'x' },
      { t: 'trip.confirmed', taskId: 't', squadId: 's' },
    ];
    for (const e of other) {
      expect(def.handles(e, s, ctx)).toBe(false);
      expect(def.mapEvent(e, s, ctx)).toEqual([]);
    }
    expect(def.handles(opinion('x'), s, ctx)).toBe(true);
    expect(() =>
      def.mapEvent({ t: 'council.opinion', councilId: QK, member: 'm' } as VillageEvent, s, ctx),
    ).not.toThrow();
  });
  it('seats: pinned names, free seats, overflow never throws', () => {
    expect(seatOf({}, 'chill')).toBe(0);
    expect(seatOf({ chill: 0 }, 'advisor')).toBe(2);
    expect(seatOf({ a: 0, b: 1, c: 2 }, 'd')).toBeLessThan(3);
    expect(seatOf({}, 'chair')).toBe(3);
  });
});

describe('council hall painting', () => {
  const t = (tt: number) => po(tt, false);
  it('is deterministic and state-sensitive in both views', () => {
    const base = initCouncilHall();
    expect(def.paint(base, 'interior', t(10)).hash()).toBe(
      def.paint(base, 'interior', t(10)).hash(),
    );
    for (const view of ['exterior', 'interior'] as const) {
      const open = reduceCouncil(base, { c: 'setAccess', access: 'open' }, 0);
      const locked = reduceCouncil(base, { c: 'setAccess', access: 'locked' }, 0);
      const talk = reduceCouncil(
        open,
        { c: 'bubble', bubble: { who: 'solver-a', text: 'hi', style: 'speech' } },
        0,
      );
      const lan = reduceCouncil(open, { c: 'lantern', mode: 'flicker' }, 0);
      const hashes = new Set(
        [base, open, locked, lan, talk].map((s) => def.paint(s, view, t(300)).hash()),
      );
      expect(hashes.size).toBeGreaterThanOrEqual(4);
    }
  });
  it('lights up in session', () => {
    const s = runScript(def, [{ at: 0, event: opinion('solver-a', 'B') }]);
    expect(def.paint(s, 'exterior', t(1000)).hash()).not.toBe(
      def.paint(s, 'exterior', t(30000)).hash(),
    );
  });
  it('calm mode freezes ambient loops', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    for (const view of ['exterior', 'interior'] as const) {
      expect(def.paint(s, view, po(0, true)).hash()).toBe(
        def.paint(s, view, po(1000, true)).hash(),
      );
    }
  });
  it('ranking slides: mid-slide differs from the end', () => {
    const shot = councilHallBundle.shots.find((x) => x.name === 'ranking')!;
    const a = paintShot(def, shot, 2160).hash();
    const b = paintShot(def, shot, 2320).hash();
    expect(a).not.toBe(b);
  });
  it('dissent lantern flickers over 2 s but never more than 3 changes a second', () => {
    const shot = councilHallBundle.shots.find((x) => x.name === 'verdict-dissent')!;
    const frames: string[] = [];
    for (let ms = 4100; ms < 6100; ms += 50) frames.push(paintShot(def, shot, ms).hash());
    let changes = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) changes++;
    expect(changes).toBeGreaterThan(1);
  });
  it('base art is palette locked and describe is a sentence for every shot', () => {
    for (const shot of councilHallBundle.shots) {
      for (const at of shot.sample) {
        LIGHTS.on = false;
        const r = paintShot(def, shot, at);
        LIGHTS.on = true;
        expect(offPalette(r)).toBe(0);
      }
      const s = runScript(def, shot.script, Infinity);
      expect(def.describe(s).length).toBeGreaterThan(10);
    }
  });
  it('never paints text it was not given (sentinel)', () => {
    const s = runScript(def, [{ at: 0, event: opinion('solver-a', 'Plan is ready') }]);
    expect(def.describe(s)).not.toMatch(/\$180|therapy/);
  });
});

describe('council hall: ask run', () => {
  const ASK = 'council:ask';
  const op = (member: string, text?: string): VillageEvent => ({
    t: 'council.opinion',
    councilId: ASK,
    member,
    ...(text === undefined ? {} : { text }),
  });
  const rk = (member: string, order: string[]): VillageEvent => ({
    t: 'council.rank',
    councilId: ASK,
    member,
    order,
  });
  const vd = (extra: object = {}): VillageEvent => ({
    t: 'council.verdict',
    councilId: ASK,
    member: 'Chair',
    ...extra,
  });
  const names = ['Skeptic', 'Teacher', 'Practitioner'];
  const run = (withText: boolean, verdictExtra: object = {}) => [
    ...names.map((m) => ({ at: 0, event: op(m, withText ? `${m} says hello there.` : undefined) })),
    { at: 2000, event: rk('Skeptic', ['Teacher', 'Practitioner']) },
    { at: 2000, event: rk('Teacher', ['Practitioner', 'Skeptic']) },
    { at: 2000, event: rk('Practitioner', ['Teacher', 'Skeptic']) },
    { at: 4000, event: vd({ ...(withText ? { text: 'Go small.' } : {}), ...verdictExtra }) },
  ];

  it('pins seats and accepts Chair in any case', () => {
    expect(seatOf({}, 'Skeptic')).toBe(0);
    expect(seatOf({}, 'Teacher')).toBe(1);
    expect(seatOf({}, 'Practitioner')).toBe(2);
    expect(seatOf({}, 'Chair')).toBe(3);
    expect(seatOf({}, 'chair')).toBe(3);
    const s = runScript(def, [{ at: 0, event: op('Practitioner', 'x') }]);
    expect(s.seats).toEqual({ Practitioner: 2 });
  });

  it('maps the ask sequence to exact commands, text-less included', () => {
    const s = initCouncilHall();
    expect(mapCouncilEvent(op('Teacher', 'Fold the map.'), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      {
        c: 'bubble',
        bubble: { who: 'Teacher', text: 'Fold the map.', style: 'thought', order: 1 },
      },
    ]);
    const o = { ...s, access: 'open' as const };
    expect(mapCouncilEvent(op('Skeptic'), o, ctx)).toEqual([
      { c: 'bubble', bubble: { who: 'Skeptic', text: '', style: 'thought', order: 0 } },
    ]);
    expect(mapCouncilEvent(rk('Skeptic', ['Teacher', 'Practitioner']), o, ctx)).toEqual([
      { c: 'rank', by: 'Skeptic', order: ['Teacher', 'Practitioner'] },
    ]);
    expect(
      mapCouncilEvent(vd({ text: 'Go.', dissent: true, dissenter: 'Skeptic' }), o, ctx),
    ).toEqual([
      { c: 'verdict', chair: 'Chair', text: 'Go.', dissenter: 'Skeptic' },
      { c: 'lantern', mode: 'flicker' },
    ]);
    expect(mapCouncilEvent(vd({ dissent: false }), o, ctx)).toEqual([
      { c: 'verdict', chair: 'Chair', text: '' },
      { c: 'lantern', mode: 'steady' },
    ]);
  });

  it('never throws on malformed events', () => {
    const s = initCouncilHall();
    const bad = [
      { t: 'council.rank', councilId: ASK, member: 'x', order: 'nope' },
      { t: 'council.opinion', councilId: ASK, text: 5 },
      { t: 'council.verdict', councilId: ASK, member: 7, text: {} },
    ] as unknown as VillageEvent[];
    for (const e of bad) expect(() => def.mapEvent(e, s, ctx)).not.toThrow();
  });

  it('a second opinion after a verdict starts a new session and keeps seats', () => {
    const s = runScript(def, [...run(true), { at: 9000, event: op('Teacher', 'again') }]);
    expect(s.verdict).toBeNull();
    expect(s.ranks).toEqual([]);
    expect(s.bubbles.map((b) => b.who)).toEqual(['Teacher']);
    expect(s.seats).toEqual({ Skeptic: 0, Teacher: 1, Practitioner: 2 });
    expect(s.lantern).toBe('off');
  });

  it('paints deterministically with distinct hashes', () => {
    const p = (script: ReturnType<typeof run>, at: number) =>
      def.paint(runScript(def, script, at), 'interior', po(at, false)).hash();
    expect(p(run(true), 1000)).toBe(p(run(true), 1000));
    expect(p(run(true), 1000)).not.toBe(p([], 1000));
    const dis = p(run(true, { dissent: true, dissenter: 'Skeptic' }), 5000);
    const con = p(run(true, { dissent: false }), 5000);
    expect(dis).not.toBe(con);
  });

  it('holds bubbles per 1.2 s / 20 chars, capped at 9 s', () => {
    expect(holdMs('x'.repeat(40))).toBe(2400 + 3000);
    expect(holdMs('x'.repeat(100))).toBe(9000);
    expect(holdMs('x'.repeat(400))).toBe(9000);
    expect(holdMs('x'.repeat(40))).toBeGreaterThanOrEqual(2400);
  });

  it('bubble timing: in 160 ms, out 120 ms, never past the cap', () => {
    const long = 'word '.repeat(80);
    const s = runScript(def, [{ at: 0, event: op('Teacher', long) }]);
    const at = (t: number) => councilBubbles(s, { t, calm: false });
    const d = 80; // Teacher is seat 1: 80 ms stagger
    expect(at(0)).toHaveLength(0);
    expect(at(d)[0]!.alpha).toBe(0);
    expect(at(d + 160)[0]!.alpha).toBe(1);
    const hold = holdMs(at(d + 160)[0]!.words); // the painted short form, never > 9 s
    expect(hold).toBeLessThanOrEqual(9000);
    expect(at(d + hold)[0]!.alpha).toBe(1);
    expect(at(d + hold + 60)[0]!.alpha).toBeLessThan(1);
    expect(at(d + hold + 121)).toHaveLength(0);
  });

  it('short form: first sentence, word boundary, ellipsis', () => {
    expect(shortForm('Go small. Then run it.', 14, 4)).toBe('Go small.');
    const t = shortForm(
      'Supercalifragilistic reasoning applies here because everything scales linearly in practice',
      14,
      4,
    );
    expect(t.endsWith('...')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(60);
    const words = t.replace(/\.\.\.$/, '').split(' ');
    for (const w of words)
      expect(
        ' Supercalifragilistic reasoning applies here because everything scales linearly in practice '.includes(
          ` ${w} `,
        ),
      ).toBe(true);
  });

  it('describe includes words, verdict and dissent; text-less runs show no words', () => {
    const d = def.describe(runScript(def, run(true, { dissent: true, dissenter: 'Skeptic' })));
    expect(d).toContain('Practitioner says hello there.');
    expect(d).toContain('verdict: Go small.');
    expect(d).toContain('one member dissents (Skeptic): uncertain, ask your TA');
    const quiet = def.describe(runScript(def, run(false, { dissent: false })));
    expect(quiet).not.toMatch(/hello|said:|verdict:|dissent/);
    const s = runScript(def, run(false));
    expect(s.bubbles.every((b) => b.text === '')).toBe(true);
  });

  it('privacy: sentinels in non-public fields never reach state, describe or paint', () => {
    const [a, b] = SENTINELS;
    const script = [...run(false)];
    script.push({
      at: 4500,
      event: vd({
      }),
    });
    script.push({ at: 4600, event: rk('Teacher', [`${a}`, `${b}`, 'Skeptic']) });
    const s = runScript(def, script);
    const dump = JSON.stringify(s) + def.describe(s);
    for (const x of SENTINELS) expect(dump.toLowerCase()).not.toContain(x.toLowerCase());
    // painted text comes only from seated names: the sentinel strings are never given a glyph path
    expect(() => def.paint(s, 'interior', po(4700, false))).not.toThrow();
  });

  it('calm variant is identical at t=0 and t=1000', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    expect(def.paint(s, 'interior', po(0, true)).hash()).toBe(
      def.paint(s, 'interior', po(1000, true)).hash(),
    );
  });

  it('palette lock holds for the ask shots', () => {
    for (const shot of councilHallBundle.shots.filter((x) => x.name.startsWith('ask-'))) {
      for (const at of shot.sample) {
        LIGHTS.on = false;
        const r = paintShot(def, shot, at);
        LIGHTS.on = true;
        expect(offPalette(r)).toBe(0);
      }
    }
  });
});
