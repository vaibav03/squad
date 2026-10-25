import { describe, expect, it } from 'vitest';
import { createInspectorStore } from './store';
import { voiceKey } from './voices';

const op = (member: string, text: string, extra: object = {}) => ({
  t: 'council.opinion',
  councilId: 'planner',
  member,
  text,
  ...extra,
});

describe('council voices', () => {
  it('normalises keys', () => {
    expect(voiceKey('council:live-skeptic')).toBe('skeptic');
    expect(voiceKey('Chairman')).toBe('chair');
    expect(voiceKey('Solver_A')).toBe('solver-a');
  });

  it('folds opinions, ranks, verdict and thoughts per member', () => {
    const t = 1000;
    const s = createInspectorStore({ me: 's_ana', now: () => t });
    s.apply(op('chill', 'Start with chapter 5.', { thought: 'Ch5 is the lightest start.' }));
    s.apply(op('grind', 'Do chapters 5 and 6 tonight.', { dissent: true }));
    s.apply({
      t: 'council.rank',
      councilId: 'planner',
      member: 'advisor',
      order: ['chill', 'grind'],
    });
    s.apply({
      t: 'council.verdict',
      councilId: 'planner',
      member: 'advisor',
      dissent: true,
      dissenter: 'grind',
    });
    const chill = s.voice('chill');
    expect(chill.thought).toEqual({ text: 'Ch5 is the lightest start.', source: 'shared' });
    expect(chill.hasThought).toBe(true);
    const grind = s.voice('grind');
    expect(grind.thought.source).toBe('stream');
    expect(grind.said[0]?.dissent).toBe(true);
    expect(grind.thread.length).toBe(4);
    expect(grind.positions.map((p) => p.who)).toContain('advisor');
    // the chair also says the verdict
    expect(s.voice('chair').said.map((l) => l.kind)).toEqual(['verdict']);
    expect(s.voice('advisor').said.map((l) => l.kind)).toEqual(['rank', 'verdict']);
  });

  it('thinking comes from work.thinking, setVoiceThinking and live ids', () => {
    let t = 0;
    const s = createInspectorStore({ now: () => t });
    s.apply(op('chill', 'x', { work: { thinking: true } }));
    expect(s.isThinking('council:planner', 'chill')).toBe(true);
    t = 60_000;
    expect(s.isThinking('council:planner', 'chill')).toBe(false);
    s.setVoiceThinking('skeptic', true);
    expect(s.isThinking('council:live-skeptic')).toBe(true);
    s.setVoiceThinking('skeptic', false);
    expect(s.isThinking('council:live-skeptic')).toBe(false);
  });

  it('noteVoice dedupes by key and live turns thread by discussion', () => {
    const s = createInspectorStore();
    const line = { who: 'Skeptic', group: 'd1', kind: 'turn' as const, text: 'Why?', key: 'd1:t1' };
    s.noteVoice(line);
    s.noteVoice(line);
    s.apply({
      t: 'discussion.turn',
      discussionId: 'd1',
      agent: 'council:live-tutor',
      member: 'tutor',
      text: 'Because.',
    });
    expect(s.voice('skeptic').thread.map((l) => l.who)).toEqual(['skeptic', 'tutor']);
  });

  it('a voice with nothing shared is honest and opens on chat', () => {
    const s = createInspectorStore();
    const v = s.voice('chill');
    expect(v.hasThought).toBe(false);
    expect(v.thought.source).toBe('none');
  });
});
