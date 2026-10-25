import { afterEach, describe, expect, it } from 'vitest';
import {
  agentName,
  clearRoster,
  looksLikeHash,
  rememberName,
  setRoster,
  studentLabel,
} from './labels';
import { adapt } from './adapt';
import { displayName, placeOf, roleOf, wordsFor } from '../inspector/describe';

const IDS = ['u_a193aba6d4e4', 's_9f3c0a7be211', 'u_0123456789ab', 's_ana', 'u_ff00ee11dd22'];
const RAW = /\b[us]_[0-9a-f]{6,}\b|\bu_[a-z0-9]+\b/i;

afterEach(() => clearRoster());

describe('names never show raw ids', () => {
  it('recognises generated hashes but not demo ids', () => {
    expect(looksLikeHash('u_a193aba6d4e4')).toBe(true);
    expect(looksLikeHash('s_ana')).toBe(false);
  });

  it('uses roster names, with the viewer first', () => {
    setRoster(
      [
        { id: 'u_a193aba6d4e4', name: 'Maya' },
        { id: 'u_ff00ee11dd22', name: 'Ben' },
      ],
      {
        id: 'u_a193aba6d4e4',
        name: 'Maya',
      },
    );
    expect(agentName('student:u_a193aba6d4e4')).toBe('Maya');
    expect(displayName('student:u_a193aba6d4e4', 'u_a193aba6d4e4')).toBe('Maya (you)');
    expect(roleOf('student:u_a193aba6d4e4', 'u_a193aba6d4e4')).toBe('Your study agent');
    expect(placeOf('student:u_a193aba6d4e4', 'idle', 'u_a193aba6d4e4')).toBe('in your house');
    expect(placeOf('student:u_ff00ee11dd22', 'idle', 'u_a193aba6d4e4')).toBe("in Ben's house");
  });

  it('rememberName supplies the signed-in account name', () => {
    rememberName('u_a193aba6d4e4', 'Maya Rao', true);
    expect(displayName('student:u_a193aba6d4e4', 'u_a193aba6d4e4')).toBe('Maya Rao (you)');
  });

  it('falls back to a friendly neutral name for unknown ids', () => {
    expect(studentLabel('u_9f3c0a7be211')).toBe('Squadmate 2');
    expect(studentLabel('u_9f3c0a7be211')).toBe('Squadmate 2');
    expect(studentLabel('u_0123456789ab')).toBe('Squadmate 3');
  });

  it('property: no rendered text contains a raw id', () => {
    for (const roster of [false, true]) {
      clearRoster();
      if (roster) setRoster([{ id: IDS[1]!, name: 'Ben' }], { id: IDS[0]!, name: 'Maya' });
      for (const id of IDS) {
        const a = `student:${id}`;
        const texts = [
          agentName(a),
          displayName(a, IDS[0]),
          displayName(a),
          roleOf(a, IDS[0]),
          roleOf(a),
          placeOf(a, 'idle', IDS[0]),
          placeOf(a, 'waiting_for_student'),
          wordsFor({ t: 'agent.state', agent: a, state: 'studying' }, false, { me: IDS[0]! }).now,
          wordsFor({ t: 'confirm.done', student: id, taskId: 't' }, false).log,
        ];
        for (const t of texts) {
          expect(t, t).not.toMatch(RAW);
          expect(t).not.toContain(id);
        }
      }
    }
  });

  it('adapter announcements and lines never carry an id, with or without a roster', () => {
    for (const roster of [false, true]) {
      clearRoster();
      if (roster) setRoster([{ id: IDS[0]!, name: 'Maya' }], { id: IDS[0]!, name: 'Maya' });
      for (const id of [...IDS, `s_${IDS[0]}`]) {
        for (const state of ['studying', 'idle', 'in_call', 'waiting_for_student'] as const) {
          const cmds = adapt({ t: 'agent.state', agent: `student:${id}`, state }, {
            me: IDS[0],
          } as never);
          const words = (v: unknown): string[] =>
            typeof v === 'string'
              ? []
              : Array.isArray(v)
                ? v.flatMap(words)
                : v && typeof v === 'object'
                  ? Object.entries(v).flatMap(([k, x]) =>
                      ['text', 'label', 'caption', 'title', 'lines'].includes(k)
                        ? [JSON.stringify(x)]
                        : words(x),
                    )
                  : [];
          for (const t of words(cmds)) expect(t).not.toMatch(RAW);
          for (const c of cmds as unknown as { type: string; text?: string }[])
            if (c.type === 'announce') expect(c.text).not.toMatch(RAW);
        }
      }
    }
  });
});
