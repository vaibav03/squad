import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';
import { pixelText, snap, tween } from './util';

const PAD_X = 4;
const PAD_Y = 3;
const TAIL_H = 6;
const GAP = 6;
const MAX_BUBBLES = 12;
const WRAP_PX = 92; // about 20 characters of the pixel font
const MAX_LINES = 3;

export interface BubbleSpec {
  key: string;
  text: string;
  lines?: readonly string[];
  minMs: number;
  tone?: 'alert';
  /** Prefix lines with a dash (shared-field lists). Off for single values. */
  bullets?: boolean;
  /** Where the tail points (world px); a function re-anchors every frame (follows a walking speaker). */
  anchor: () => { x: number; y: number } | undefined;
  /** Lane for the commons: bubbles in the same lane never overlap; later ones wait. */
  lane?: string;
}

interface Live {
  spec: BubbleSpec;
  box: Phaser.GameObjects.Container;
  bornAt: number;
  leaving: boolean;
  timer?: Phaser.Time.TimerEvent;
  h: number;
  w: number;
}

export interface BubbleManager {
  show(spec: BubbleSpec): void;
  dismiss(key: string): void;
  update(): void;
  readonly count: number;
  destroy(): void;
}

export function createBubbles(ctx: VillageContext): BubbleManager {
  const live = new Map<string, Live>();
  const queued: BubbleSpec[] = [];
  const laneBusy = (lane: string) =>
    [...live.values()].some((b) => b.spec.lane === lane && !b.leaving);

  const build = (spec: BubbleSpec): Live | undefined => {
    const a = spec.anchor();
    if (!a) return undefined;
    const body = [
      spec.text,
      ...(spec.lines ?? []).slice(0, MAX_LINES).map((l) => (spec.bullets === false ? l : `- ${l}`)),
    ].join('\n');
    const label = pixelText(ctx, body, { color: 'ink', wrap: WRAP_PX, size: 9.333 });
    const iconW = spec.tone === 'alert' ? 10 : 0;
    const w = Math.max(24, Math.ceil(label.width) + PAD_X * 2 + iconW);
    const h = Math.max(18, Math.ceil(label.height) + PAD_Y * 2);
    const slice = ctx.scene.add
      .nineslice(0, 0, 'mv-bubble-wall', undefined, w, h, 5, 5, 5, 5)
      .setOrigin(0, 0);
    const tail = ctx.scene.add.image(0, 0, 'mv-tail-wall-l').setOrigin(0, 0);
    const kids: Phaser.GameObjects.GameObject[] = [slice, tail, label];
    let icon: Phaser.GameObjects.Image | undefined;
    if (spec.tone === 'alert') {
      icon = ctx.scene.add.image(0, 0, 'mv-alert').setOrigin(0, 0.5);
      kids.push(icon);
    }
    const box = ctx.scene.add.container(0, 0, kids).setDepth(ctx.depth.actorFx + 5);
    // local layout: bubble spans x [-w/2, w/2], bottom edge at -(TAIL_H - 1), tail tip at (0,0)
    slice.setPosition(-Math.floor(w / 2), -(TAIL_H - 1) - h);
    tail.setPosition(-3, -(TAIL_H - 1) - 1 + 1);
    label.setPosition(slice.x + PAD_X + iconW, slice.y + PAD_Y);
    icon?.setPosition(slice.x + PAD_X, slice.y + h / 2);
    return { spec, box, bornAt: ctx.scene.time.now, leaving: false, h, w };
  };

  const place = (b: Live) => {
    const a = b.spec.anchor();
    if (!a) return;
    const cam = ctx.scene.cameras.main;
    const half = Math.floor(b.w / 2);
    const left = cam.scrollX + 4 + half;
    const right = cam.scrollX + cam.width - 4 - half;
    const x = Math.min(Math.max(a.x, left), Math.max(left, right));
    b.box.setPosition(snap(x), snap(a.y - GAP));
    // tail tip stays on the anchor even when the box is clamped: shift the tail, not the text
    const tail = b.box.list[1] as Phaser.GameObjects.Image;
    tail.x = Math.min(Math.max(Math.round(a.x - x) - 3, -half + 6), half - 12);
  };

  const exit = (b: Live) => {
    if (b.leaving) return;
    b.leaving = true;
    b.timer?.remove(false);
    tween(ctx, b.box, ctx.calm ? { alpha: 0 } : { alpha: 0, scaleX: 0.95, scaleY: 0.95 }, {
      ms: 120,
      onComplete: () => {
        b.box.destroy();
        if (live.get(b.spec.key) === b) live.delete(b.spec.key);
        pump();
      },
    });
  };

  const pump = () => {
    for (let i = 0; i < queued.length; i++) {
      const s = queued[i]!;
      if (s.lane && laneBusy(s.lane)) continue;
      queued.splice(i, 1);
      start(s);
      i--;
    }
  };

  const start = (spec: BubbleSpec) => {
    const old = live.get(spec.key);
    if (old) {
      old.box.destroy();
      old.timer?.remove(false);
      live.delete(spec.key);
    }
    // cap: drop the oldest when over the pool limit
    if (live.size >= MAX_BUBBLES) {
      const oldest = [...live.values()].sort((a, b) => a.bornAt - b.bornAt)[0];
      if (oldest) exit(oldest);
    }
    const b = build(spec);
    if (!b) return;
    live.set(spec.key, b);
    place(b);
    b.box.setAlpha(0);
    if (!ctx.calm) b.box.setScale(0.95);
    tween(ctx, b.box, ctx.calm ? { alpha: 1 } : { alpha: 1, scaleX: 1, scaleY: 1 }, { ms: 160 });
    b.timer = ctx.scene.time.delayedCall(spec.minMs, () => exit(b));
  };

  return {
    show(spec) {
      if (spec.lane && laneBusy(spec.lane)) queued.push(spec);
      else start(spec);
    },
    dismiss(key) {
      const qi = queued.findIndex((q) => q.key === key);
      if (qi >= 0) queued.splice(qi, 1);
      const b = live.get(key);
      if (!b) return;
      // words stay for their full dwell: dismiss only schedules the exit after minMs
      const left = Math.max(0, b.spec.minMs - (ctx.scene.time.now - b.bornAt));
      b.timer?.remove(false);
      b.timer = ctx.scene.time.delayedCall(left, () => exit(b));
    },
    update() {
      for (const b of live.values()) if (!b.leaving) place(b);
    },
    get count() {
      return live.size;
    },
    destroy() {
      for (const b of live.values()) {
        b.timer?.remove(false);
        b.box.destroy();
      }
      live.clear();
      queued.length = 0;
    },
  };
}
