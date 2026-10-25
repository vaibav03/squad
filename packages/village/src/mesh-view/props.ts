import type Phaser from 'phaser';
import type { LedgerCard } from '../adapter';
import type { VillageContext } from '../world/api';
import { tween } from './util';

/** Slot origins on notice-board.png (docs/design asset set): 6 cards, 3 columns x 2 rows, 16x12 each. */
const SLOTS: readonly (readonly [number, number])[] = [
  [5, 15],
  [23, 15],
  [41, 15],
  [5, 28],
  [23, 28],
  [41, 28],
];
const BOARD = { w: 64, h: 48 };

export interface Campfire {
  readonly x: number;
  /** Where visitors stand: cycles through spots left/right of the fire. */
  visitorSpot(index: number): number;
  /** Pin spot for envelopes resting at the fire (on the stump). */
  pinSpot(index: number): { x: number; y: number };
  update(): void;
  destroy(): void;
}

export function createCampfire(ctx: VillageContext): Campfire {
  const g = ctx.layout.groundY;
  const x = ctx.layout.slot('commons').x;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
    objs.push(o);
    return o;
  };
  const sc = ctx.scene;

  if (!sc.anims.exists('mv-fire')) {
    sc.anims.create({
      key: 'mv-fire',
      frames: sc.anims.generateFrameNumbers('mv-fire', { start: 0, end: 5 }),
      frameRate: 9,
      repeat: -1,
    });
    sc.anims.create({
      key: 'mv-sparks',
      frames: sc.anims.generateFrameNumbers('mv-sparks', { start: 0, end: 2 }),
      frameRate: 6,
      repeat: -1,
    });
  }

  // light pool first (additive, stepped bands from the asset set), then props, then the fire
  const light = add(
    sc.add
      .image(x, g - 4, 'mv-camp-light')
      .setOrigin(0.5, 0.5)
      .setDepth(ctx.depth.props - 2)
      .setAlpha(0.28)
      .setBlendMode(1),
  );
  add(
    sc.add
      .image(x + 46, g + 1, 'mv-stump')
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.props - 1),
  );
  add(
    sc.add
      .image(x, g + 1, 'mv-camp-base')
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.props),
  );
  const fire = add(
    sc.add
      .sprite(x, g - 4, 'mv-fire', 0)
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.props + 1),
  );
  const sparks = add(
    sc.add
      .sprite(x, g - 24, 'mv-sparks', 0)
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.props + 2),
  );
  const sync = () => {
    if (ctx.calm) {
      fire.anims.stop();
      fire.setFrame(0);
      sparks.setVisible(false);
      sparks.anims.stop();
    } else {
      if (!fire.anims.isPlaying) fire.play('mv-fire');
      sparks.setVisible(true);
      if (!sparks.anims.isPlaying) sparks.play('mv-sparks');
    }
  };
  sync();

  return {
    x,
    visitorSpot: (i) => x + [-38, -58, 32, -78, 56, -98][i % 6]!,
    pinSpot: (i) => ({ x: x + 36 + (i % 3) * 10, y: g - 23 }),
    update() {
      const wantsAnim = !ctx.calm;
      if (wantsAnim !== fire.anims.isPlaying) sync();
      void light;
    },
    destroy() {
      objs.forEach((o) => o.destroy());
    },
  };
}

export interface Board {
  readonly x: number;
  /** Pins a card in the next slot (oldest replaced when full); returns the slot index. */
  pin(card: LedgerCard): number;
  /** Centre-top of the board for flyout bubbles. */
  anchor(): { x: number; y: number };
  destroy(): void;
}

export function createBoard(ctx: VillageContext): Board {
  const g = ctx.layout.groundY;
  const x = ctx.layout.slot('notice-board').x;
  const left = x - BOARD.w / 2;
  const top = g + 1 - BOARD.h;
  const sc = ctx.scene;
  const img = sc.add
    .image(x, g + 1, 'mv-board-lit')
    .setOrigin(0.5, 1)
    .setDepth(ctx.depth.props);
  const cards: (Phaser.GameObjects.Image | undefined)[] = new Array(SLOTS.length).fill(undefined);
  let next = 0;

  return {
    x,
    pin(card) {
      const i = next++ % SLOTS.length;
      const [sx, sy] = SLOTS[i]!;
      cards[i]?.destroy();
      const key =
        card.kind === 'shared'
          ? 'mv-card-shared'
          : card.kind === 'hidden'
            ? 'mv-card-hidden'
            : 'mv-card-blocked';
      const c = sc.add
        .image(left + sx, top + sy, key)
        .setOrigin(0, 0)
        .setDepth(ctx.depth.props + 1)
        .setAlpha(0);
      cards[i] = c;
      // 200 ms ease-out, 6 px drop plus opacity (design 8.9); reduced: opacity only
      if (!ctx.calm) c.y -= 6;
      tween(ctx, c, ctx.calm ? { alpha: 1 } : { alpha: 1, y: top + sy }, { ms: 200 });
      return i;
    },
    anchor: () => ({ x, y: top + 2 }),
    destroy() {
      img.destroy();
      cards.forEach((c) => c?.destroy());
    },
  };
}
