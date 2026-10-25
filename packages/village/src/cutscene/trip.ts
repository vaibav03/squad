import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';
import { pixelText, snap } from '../mesh-view/util';
import { spring } from '../mesh-view/motion-stub';
import { calmFrame, fadeOutStartMs, tripFrame } from './timeline';
import type { TripGeometry } from './timeline';

const TOP = 1000; // depth above everything in the world (HUD is DOM)
const LAMP_SPACING = 168;

export interface TripCutscene {
  update(dtMs: number): void;
  /** Any key or tap: jump to the end of the drive; the door still pops. */
  skip(): void;
  readonly done: boolean;
  destroy(): void;
}

export interface TripDoor {
  show(opts: { pop: boolean }): void;
  destroy(): void;
}

/** The persistent Trip door in the world, at the 'trip-road' slot. */
export function createTripDoor(ctx: VillageContext, taskId: string): TripDoor {
  const slot = ctx.layout.slot('trip-road');
  const g = ctx.layout.groundY;
  const sc = ctx.scene;
  let shown = false;
  const objs: Phaser.GameObjects.GameObject[] = [];
  let unregister: (() => void) | undefined;
  return {
    show({ pop }) {
      if (shown) return;
      shown = true;
      const lamp = sc.add
        .image(slot.x - 40, g + 1, 'mv-lamp')
        .setOrigin(0.5, 1)
        .setDepth(ctx.depth.props);
      const halo = sc.add
        .image(slot.x - 40, g - 52, 'mv-lamp-halo')
        .setDepth(ctx.depth.props - 1)
        .setAlpha(0.3)
        .setBlendMode(1);
      const door = sc.add
        .image(slot.x, g + 1, 'mv-trip-door', 1)
        .setOrigin(0.5, 1)
        .setDepth(ctx.depth.props);
      objs.push(lamp, halo, door);
      if (pop && !ctx.calm) {
        // spring 0.5 s, bounce 0.2: 0.95 -> 1 with a small overshoot, plus opacity
        door.setAlpha(0).setScale(0.95);
        const p = { t: 0 };
        sc.tweens.add({
          targets: p,
          t: 1,
          duration: 500,
          ease: 'Linear',
          onUpdate: () => {
            const k = spring(p.t);
            door.setScale(0.95 + 0.05 * k).setAlpha(Math.min(1, p.t * 4));
          },
          onComplete: () => door.setScale(1).setAlpha(1),
        });
      } else if (pop) {
        door.setAlpha(0);
        sc.tweens.add({ targets: door, alpha: 1, duration: 200, ease: ctx.motion.easeOut });
      }
      ctx.bus.emit('tripDoor', { visible: true });
      unregister = ctx.interactables.register({
        id: 'trip-door',
        x: slot.door?.x ?? slot.x,
        radius: 28,
        label: 'Go to Trip door',
        onActivate: () => ctx.bus.emit('overlay', { type: 'openLedger', taskId }),
      });
    },
    destroy() {
      unregister?.();
      objs.forEach((o) => o.destroy());
    },
  };
}

/** The cutscene itself: screen-space layers over a dimmed world, driven by the pure timeline. */
export function createTripCutscene(
  ctx: VillageContext,
  o: { onDoor: () => void; onEnd: () => void },
): TripCutscene {
  const sc = ctx.scene;
  const cam = sc.cameras.main;
  const viewW = cam.width;
  const viewH = cam.height;
  const groundScreen = ctx.layout.groundY - cam.scrollY;
  const geom: TripGeometry = { viewW, vanW: 64 };
  const calm = ctx.calm;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const add = <
    T extends Phaser.GameObjects.GameObject & {
      setScrollFactor(x: number): unknown;
      setDepth(d: number): unknown;
    },
  >(
    go: T,
    depth = 0,
  ): T => {
    go.setScrollFactor(0);
    go.setDepth(TOP + depth);
    objs.push(go);
    return go;
  };
  let elapsed = 0;
  let doorFired = false;
  let panned = false;
  let finished = false;

  const dim = add(sc.add.rectangle(0, 0, viewW, viewH, 0x070f1f, 0).setOrigin(0, 0));
  const title = add(pixelText(ctx, 'Trip confirmed', { color: 'moon', size: 18.667 }), 6).setAlpha(
    0,
  );
  const sub = add(
    pixelText(ctx, 'Everyone said yes.', { color: 'wallLit', size: 9.333 }),
    6,
  ).setAlpha(0);
  title.setPosition(snap((viewW - title.width) / 2), snap(viewH * 0.18));
  sub.setPosition(snap((viewW - sub.width) / 2), snap(viewH * 0.18 + title.height + 2));

  // normal mode layers
  const roadTop = groundScreen - 6;
  const road = calm
    ? undefined
    : add(sc.add.tileSprite(0, roadTop, viewW, 16, 'mv-road').setOrigin(0, 0), 1).setAlpha(0);
  const lamps: Array<{ post: Phaser.GameObjects.Image; halo: Phaser.GameObjects.Image }> = [];
  const nLamps = Math.ceil(viewW / LAMP_SPACING) + 2;
  if (!calm) {
    for (let i = 0; i < nLamps; i++) {
      const halo = add(
        sc.add
          .image(0, roadTop - 44, 'mv-lamp-halo')
          .setAlpha(0.3)
          .setBlendMode(1),
        1,
      );
      const post = add(sc.add.image(0, roadTop + 6, 'mv-lamp').setOrigin(0.5, 1), 2);
      lamps.push({ post, halo });
    }
  }
  if (!sc.anims.exists('mv-van')) {
    sc.anims.create({
      key: 'mv-van',
      frames: sc.anims.generateFrameNumbers('mv-van', { start: 0, end: 1 }),
      frameRate: 6,
      repeat: -1,
    });
  }
  const van = calm
    ? undefined
    : add(sc.add.sprite(-100, roadTop + 12, 'mv-van', 0).setOrigin(0.5, 1), 3);

  // calm card: bubble-style panel with the same words
  let card: Phaser.GameObjects.NineSlice | undefined;
  if (calm) {
    const w = Math.max(title.width, sub.width) + 16;
    const h = Math.ceil(title.height + sub.height) + 12;
    card = add(
      sc.add.nineslice(0, 0, 'mv-bubble-wall', undefined, w, h, 5, 5, 5, 5).setOrigin(0, 0),
      4,
    ).setAlpha(0);
    card.setPosition(snap((viewW - w) / 2), snap(viewH * 0.18 - 6));
    title.setColor('#070f1f').setDepth(TOP + 6);
    sub.setColor('#070f1f');
  }

  const fadeAt = fadeOutStartMs(geom);
  const unlock = ctx.player.lockInput();

  const finish = () => {
    if (finished) return;
    finished = true;
    unlock();
    o.onEnd();
  };

  return {
    get done() {
      return finished;
    },
    skip() {
      if (calm) elapsed = Math.max(elapsed, 200 + 2400);
      else elapsed = Math.max(elapsed, fadeAt);
    },
    update(dtMs) {
      if (finished) return;
      elapsed += Math.min(dtMs, 100); // never catch up after a hidden tab
      if (calm) {
        const f = calmFrame(elapsed);
        card?.setAlpha(f.cardAlpha);
        title.setAlpha(f.cardAlpha);
        sub.setAlpha(f.cardAlpha);
        if (!doorFired && f.doorAlpha > 0) {
          doorFired = true;
          o.onDoor();
        }
        if (f.done) finish();
        return;
      }
      const f = tripFrame(elapsed, geom);
      dim.setFillStyle(0x070f1f, f.dim);
      road?.setAlpha(f.dim / 0.55);
      if (road) road.tilePositionX = snap(f.roadOffset);
      lamps.forEach((l, i) => {
        const span = nLamps * LAMP_SPACING;
        const x = snap((((i * LAMP_SPACING - f.roadOffset) % span) + span) % span) - LAMP_SPACING;
        l.post.setPosition(x, roadTop + 6).setAlpha(f.dim / 0.55);
        l.halo.setPosition(x, roadTop - 44).setAlpha((0.3 * f.dim) / 0.55);
      });
      if (van) {
        // arrives from the left while the road decelerates, then drives off to the right
        const arriving = elapsed < 250 + 2400;
        const x = arriving
          ? snap(geom.viewW * 0.34 - (1 - Math.min(1, elapsed / 700)) * 140)
          : f.vanX;
        van.setPosition(x, roadTop + 12);
        van.setAlpha(f.dim / 0.55 > 0.05 ? 1 : 0);
        const moving = f.roadSpeedPxS > 12 || elapsed >= 250 + 2400;
        if (moving && !van.anims.isPlaying) van.play('mv-van');
        if (!moving && van.anims.isPlaying) {
          van.anims.stop();
          van.setFrame(0);
        }
      }
      title.setAlpha(f.captionAlpha);
      sub.setAlpha(f.captionAlpha);
      if (!panned && elapsed >= fadeAt - 400) {
        panned = true;
        // bring the Trip door into view while the dim lifts (400 ms ease-in-out, world camera)
        void ctx.camera.panTo(ctx.layout.slot('trip-road').x, { holdMs: 3500 });
      }
      if (!doorFired && f.doorVisible) {
        doorFired = true;
        o.onDoor();
      }
      if (f.done) finish();
    },
    destroy() {
      objs.forEach((go) => go.destroy());
      if (!finished) {
        finished = true;
        unlock();
      }
    },
  };
}
