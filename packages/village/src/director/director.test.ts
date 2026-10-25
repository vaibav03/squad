import { describe, expect, it } from 'vitest';
import type { SceneCommand } from '../adapter';
import {
  BURST_MS,
  MANUAL_QUIET_MS,
  MIN_GAP_MS,
  RELEASE_IDLE_MS,
  createDirector,
  proposalFor,
} from './director';

const msg = (agent: string): SceneCommand[] => [
  { type: 'spawnEnvelope', id: 'e', from: agent, to: 'commons', taskId: 't', kind: 'psi.blind' },
  { type: 'walkTo', agent, to: { kind: 'commons' }, carrying: 'e' },
  {
    type: 'showBubble',
    key: 'b',
    at: { kind: 'commons' },
    style: 'speech',
    text: 'Psi tokens',
    minMs: 1200,
  },
];
const feed = (d: ReturnType<typeof createDirector>, cmds: SceneCommand[], t: number) =>
  cmds.forEach((c) => d.observe(c, t));

describe('proposalFor', () => {
  it('maps events to the place they concern, with higher scores for alerts and captions', () => {
    expect(
      proposalFor({ type: 'marker', at: { kind: 'commons' }, reason: 'conflict', key: 'k' }),
    ).toMatchObject({ target: { kind: 'commons' }, score: 8 });
    expect(
      proposalFor({ type: 'chalkboard', chapter: 'ch6', mark: 'question', mine: true }),
    ).toMatchObject({ target: { kind: 'house', chapter: 'ch6' }, score: 7 });
    expect(
      proposalFor({ type: 'councilVerdict', councilId: 'council:planner', member: 'x', text: 't' }),
    ).toMatchObject({ target: { kind: 'hall', councilId: 'council:planner' } });
    expect(proposalFor({ type: 'ring', agent: 'student:s_ben', on: true })?.target).toEqual({
      kind: 'door',
      agent: 'student:s_ben',
    });
  });
  it('ignores overlays, the trip cutscene, announcements, the mediator and rings turning off', () => {
    for (const c of [
      { type: 'openOverlay', request: { overlay: 'close', which: 'call' } },
      { type: 'playTrip', taskId: 't', squadId: 's' },
      { type: 'announce', text: 'x', politeness: 'polite' },
      { type: 'ring', agent: 'student:s_ben', on: false },
      { type: 'ring', agent: 'mediator', on: true },
    ] as unknown as SceneCommand[])
      expect(proposalFor(c)).toBeNull();
  });
});

describe('director', () => {
  it('merges a burst into one shot and picks the most meaningful target', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 1000);
    d.observe({ type: 'marker', at: { kind: 'commons' }, reason: 'conflict', key: 'k' }, 1010);
    expect(d.tick(1000)).toBeNull(); // still inside the burst window
    const s = d.tick(1000 + BURST_MS);
    expect(s).toMatchObject({ action: 'shot', key: 'commons', score: 8, jump: false });
    expect(d.tick(1000 + BURST_MS + 10)).toBeNull();
  });

  it('moves at most once per MIN_GAP_MS and holds the latest proposal for the next move', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 0);
    expect(d.tick(BURST_MS)).toMatchObject({ key: 'commons' });
    d.observe({ type: 'ring', agent: 'student:s_cam', on: true }, 300);
    expect(d.tick(300 + BURST_MS)).toBeNull(); // too soon after the last move
    expect(d.tick(BURST_MS + MIN_GAP_MS)).toMatchObject({ key: 'door:student:s_cam' });
  });

  it('does not re-send the camera to where it already is', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 0);
    expect(d.tick(BURST_MS)).toMatchObject({ key: 'commons' });
    d.observe({ type: 'marker', at: { kind: 'commons' }, reason: 'conflict', key: 'k' }, 5000);
    expect(d.tick(5000 + BURST_MS)).toBeNull();
  });

  it('Calm mode asks for a jump cut', () => {
    const d = createDirector({ calm: () => true });
    feed(d, msg('student:s_ben'), 0);
    expect(d.tick(BURST_MS)).toMatchObject({ jump: true });
  });

  it('never fights the viewer: manual input silences it for 5 s and drops the queue', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 0);
    d.userInput(50);
    expect(d.tick(BURST_MS)).toBeNull();
    d.observe({ type: 'ring', agent: 'student:s_cam', on: true }, 1000); // during the quiet window: ignored
    expect(d.tick(1000 + BURST_MS)).toBeNull();
    expect(d.tick(50 + MANUAL_QUIET_MS - 1)).toBeNull();
    d.observe({ type: 'ring', agent: 'student:s_cam', on: true }, 50 + MANUAL_QUIET_MS);
    expect(d.tick(50 + MANUAL_QUIET_MS + BURST_MS)).toMatchObject({ key: 'door:student:s_cam' });
  });

  it('releases the camera back to the player after a quiet spell', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 0);
    expect(d.tick(BURST_MS)).toMatchObject({ action: 'shot' });
    expect(d.tick(RELEASE_IDLE_MS - 1)).toBeNull();
    expect(d.tick(RELEASE_IDLE_MS + 1)).toEqual({ action: 'release' });
    expect(d.tick(RELEASE_IDLE_MS + 2)).toBeNull();
  });

  it('drops stale proposals', () => {
    const d = createDirector({ calm: () => false });
    feed(d, msg('student:s_ben'), 0);
    expect(d.tick(0 + 4000)).toBeNull(); // older than the candidate TTL
  });
});
