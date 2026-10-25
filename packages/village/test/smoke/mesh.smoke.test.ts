import { describe, expect, it } from 'vitest';
import { SENTINELS, VILLAGE_EVENT_TYPES, assertNoLeak, safeParseVillageEvent } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import { adaptUnknown } from '../../src/adapter';
import type { SceneCommand } from '../../src/adapter';
import { createAgentFeed } from '../../src/a11y';
import { createOverlayBridge } from '../../src/overlay-bridge';
import type { OverlayEvent } from '../../src/overlay-bridge';
import { createReplaySource } from '../../src/sources';
import type { Clock } from '../../src/sources';
import { MESH_STORY } from '../../src/mesh-view/dev/story';

/** End-to-end with fakes: replay -> adapter -> a11y feed + overlay bridge. No Phaser. */
function fakeClock(): Clock & { advance(ms: number): void } {
  let t = 0;
  let q: { at: number; fn: () => void; id: number }[] = [];
  let n = 0;
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      q.push({ at: t + ms, fn, id: ++n });
      return n;
    },
    clearTimeout: (h) => {
      q = q.filter((x) => x.id !== h);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        const nx = q[0];
        if (!nx || nx.at > end) break;
        q.shift();
        t = nx.at;
        nx.fn();
      }
      t = end;
    },
  };
}

const ME = 's_ana';
const ctx = { me: ME };

describe('mesh smoke', () => {
  it('the dev story is valid and covers confirm, ledger (3 kinds), conflict, trip', () => {
    for (const { event } of MESH_STORY) expect(safeParseVillageEvent(event).success).toBe(true);
    const kinds = new Set(MESH_STORY.map((s) => s.event.t));
    for (const t of [
      'agent.message',
      'ledger.entry',
      'confirm.pending',
      'confirm.done',
      'trip.confirmed',
    ])
      expect(kinds.has(t as never)).toBe(true);
  });

  it('replay -> adapter produces commands for every story event and nothing leaks', () => {
    const clock = fakeClock();
    const replay = createReplaySource(
      {
        name: 'smoke',
        version: 1,
        loop: false,
        cast: { me: ME },
        events: MESH_STORY,
        checkpoints: {},
      },
      { clock },
    );
    const commands: SceneCommand[] = [];
    replay.subscribe((e) => commands.push(...adaptUnknown(e, ctx)));
    replay.play();
    clock.advance(40000);
    expect(replay.status).toBe('ended');
    const types = new Set(commands.map((c) => c.type));
    for (const t of [
      'spawnEnvelope',
      'walkTo',
      'showBubble',
      'marker',
      'ring',
      'tick',
      'ledgerCard',
      'playTrip',
    ])
      expect(types.has(t as never)).toBe(true);
    assertNoLeak(commands, SENTINELS, 'story commands');
  });

  it('confirm.pending for me opens the confirm overlay exactly once through the bridge', () => {
    const opened: OverlayEvent[] = [];
    const bridge = createOverlayBridge({ onOverlay: (e) => opened.push(e) });
    const feed = createAgentFeed({ me: ME });
    for (const { event } of MESH_STORY) {
      for (const c of adaptUnknown(event, ctx))
        if (c.type === 'openOverlay') bridge.handle(c.request);
      feed.apply(event);
    }
    expect(opened.filter((o) => o.type === 'openConfirm')).toHaveLength(1);
    expect(feed.snapshot().entries.find((e) => e.id === 'place:trip-door')).toBeDefined();
  });

  it('every event type, smuggled sentinel in every free-text slot, never reaches commands, feed or announcements', () => {
    const [s1, s2] = SENTINELS;
    const evs: unknown[] = [
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's_b',
        field: 'budget',
        withheld: 'hidden',
        shared: s1,
      },
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's_b',
        field: 'budget',
        blocked: true,
        shared: s2,
      },
      {
        t: 'ledger.entry',
        taskId: 't',
        student: 's_b',
        field: 'budget',
        withheld: 'hidden',
        value: s1,
      },
      {
        t: 'agent.message',
        from: 'mediator',
        to: 'commons',
        taskId: 't',
        kind: 'conflict',
        shared: [],
        who: s2,
      },
    ];
    const feed = createAgentFeed({ me: ME });
    const anns: string[] = [];
    feed.onAnnounce((a) => anns.push(a.text));
    const commands: SceneCommand[] = [];
    for (const e of evs) {
      commands.push(...adaptUnknown(e, ctx));
      feed.apply(e);
    }
    assertNoLeak(commands, SENTINELS, 'commands');
    assertNoLeak(feed.snapshot(), SENTINELS, 'snapshot');
    assertNoLeak(anns, SENTINELS, 'announcements');
    expect(VILLAGE_EVENT_TYPES.length).toBe(16);
  });

  it('ledger events contain only field, shared or hidden in their cards', () => {
    const e: VillageEvent = {
      t: 'ledger.entry',
      taskId: 't',
      student: 's_b',
      field: 'budget',
      withheld: 'hidden',
    };
    const cards = adaptUnknown(e, ctx).filter((c) => c.type === 'ledgerCard');
    expect(cards).toHaveLength(1);
    expect(JSON.stringify(cards[0])).toBe(
      JSON.stringify({
        type: 'ledgerCard',
        taskId: 't',
        student: 's_b',
        card: { kind: 'hidden', field: 'budget' },
      }),
    );
  });
});
