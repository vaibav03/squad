import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX } from '../../contract';
import { paintShot, po, runScript } from '../../testkit';
import { commonSuite, SENTINELS } from '../a-suite';
import { feynmanPorch, feynmanPorchBundle } from './index';

const AG = 'expert:feynman';
const ctx = DEFAULT_CTX;
const quiz = (
  t: 'quiz.question' | 'quiz.answer' | 'quiz.result',
  correct?: boolean,
  chapter = 'feynman',
): VillageEvent => ({
  t,
  quizId: 'q',
  chapter,
  ...(correct === undefined ? {} : { correct }),
});
const state = (st: 'idle' | 'studying' | 'in_call' | 'waiting_for_student'): VillageEvent => ({
  t: 'agent.state',
  agent: AG,
  state: st,
});

const active = [
  { at: 0, event: state('waiting_for_student') },
  { at: 100, event: quiz('quiz.question') },
];

commonSuite(feynmanPorchBundle, state('studying'), { activeScript: active, defaultAccess: 'dim' });

describe('feynman-porch mapEvent', () => {
  const s = feynmanPorch.init();
  const say = (text: string) => ({ c: 'bubble', bubble: { who: 'expert', text, style: 'speech' } });
  it('agent.state: occupant, ring and the freshman asking', () => {
    expect(feynmanPorch.mapEvent(state('waiting_for_student'), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'setOccupant', state: 'waiting' },
      { c: 'setRing', on: true },
      { c: 'bubble', bubble: { who: 'expert', text: 'But why?', style: 'thought' } },
    ]);
    expect(feynmanPorch.mapEvent(state('studying'), { ...s, access: 'open' }, ctx)).toEqual([
      { c: 'setOccupant', state: 'studying' },
      { c: 'setRing', on: false },
      { c: 'bubble', bubble: { who: 'expert', text: 'Hmm, why?', style: 'thought' } },
    ]);
    expect(feynmanPorch.mapEvent(state('idle'), { ...s, access: 'open' }, ctx)).toEqual([
      { c: 'setOccupant', state: 'idle' },
      { c: 'setRing', on: false },
      { c: 'clearBubble', who: 'expert' },
    ]);
  });
  it('in_call state has no bubble of its own', () => {
    expect(feynmanPorch.mapEvent(state('in_call'), { ...s, access: 'open' }, ctx)).toEqual([
      { c: 'setOccupant', state: 'in_call' },
      { c: 'setRing', on: false },
    ]);
  });
  it('quiz.* on the feynman chapter drives naive whys; other chapters are not ours', () => {
    const open = { ...s, access: 'open' as const };
    expect(feynmanPorch.mapEvent(quiz('quiz.question'), open, ctx)).toEqual([
      { c: 'setOccupant', state: 'studying' },
      say('But why is that?'),
    ]);
    expect(feynmanPorch.mapEvent(quiz('quiz.answer', true), open, ctx)).toEqual([
      say('Ohh... but why?'),
    ]);
    expect(feynmanPorch.mapEvent(quiz('quiz.answer', false), open, ctx)).toEqual([
      say('Wait, why does that work?'),
    ]);
    expect(feynmanPorch.mapEvent(quiz('quiz.result', true), open, ctx)).toEqual([
      { c: 'setOccupant', state: 'idle' },
      say('Oh! I get it now.'),
    ]);
    expect(feynmanPorch.mapEvent(quiz('quiz.result', false), open, ctx)[1]).toEqual(
      say('Still lost. Why?'),
    );
    expect(feynmanPorch.handles(quiz('quiz.question', undefined, 'ch1'), s, ctx)).toBe(false);
  });
  it('calls: portrait, 90-char caption, end', () => {
    expect(
      feynmanPorch.mapEvent(
        { t: 'call.start', agent: AG, callId: 'c' },
        { ...s, access: 'open' },
        ctx,
      ),
    ).toEqual([
      { c: 'setOccupant', state: 'in_call' },
      { c: 'setRing', on: false },
      { c: 'portrait', on: true },
    ]);
    const long = 'why '.repeat(30);
    const cmds = feynmanPorch.mapEvent(
      { t: 'call.caption', agent: AG, callId: 'c', text: long },
      s,
      ctx,
    );
    const b = cmds.find((c) => c.c === 'bubble');
    expect(b && b.c === 'bubble' ? b.bubble.text.length : 0).toBeLessThanOrEqual(90);
    expect(
      feynmanPorch.mapEvent(
        { t: 'call.caption', agent: AG, callId: 'c' },
        { ...s, access: 'open' },
        ctx,
      ),
    ).toEqual([{ c: 'portrait', on: true }]);
  });
  it('agent.message: kind in plain words and shared labels only; sentinels are scrubbed', () => {
    const e: VillageEvent = {
      t: 'agent.message',
      from: AG,
      to: 'commons',
      taskId: 't',
      kind: 'query_denied',
      shared: ['budget cap', '$180', 'therapy!'],
    };
    const cmds = feynmanPorch.mapEvent(e, { ...s, access: 'open' }, ctx);
    const b = cmds[0];
    expect(b && b.c === 'bubble' ? b.bubble.text : '').toBe(
      'Query denied: budget cap, 180, therapy',
    );
    const state2 = runScript(feynmanPorch, [{ at: 0, event: e }]);
    expect(JSON.stringify(state2)).not.toContain('$180');
    expect(SENTINELS.includes('$180')).toBe(true);
  });
});

describe('feynman-porch motion', () => {
  const shot = feynmanPorchBundle.shots.find((x) => x.name === 'interior-asking')!;
  it('gaze wanders over time but not in calm; the question mark is static', () => {
    const a = paintShot(feynmanPorch, shot, 1500).hash();
    const b = paintShot(feynmanPorch, shot, 3300).hash();
    expect(a).not.toBe(b);
    const s = runScript(feynmanPorch, shot.script, 2600);
    const c0 = feynmanPorch.paint(s, 'interior', po(2000, true)).hash();
    const c1 = feynmanPorch.paint(s, 'interior', po(2600, true)).hash();
    expect(c0).toBe(c1);
  });
  it('chimney smoke only when open; steady in calm', () => {
    const open = { ...feynmanPorch.init(), access: 'open' as const };
    const dim = feynmanPorch.init();
    expect(feynmanPorch.paint(open, 'exterior', po(0, false)).hash()).not.toBe(
      feynmanPorch.paint(open, 'exterior', po(400, false)).hash(),
    );
    expect(feynmanPorch.paint(dim, 'exterior', po(0, false)).hash()).toBe(
      feynmanPorch.paint(dim, 'exterior', po(400, false)).hash(),
    );
  });
});
