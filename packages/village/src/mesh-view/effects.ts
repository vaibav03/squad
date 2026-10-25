import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';
import { spring } from './motion-stub';
import { pixelText, snap, tween } from './util';

/** Door rings, "!" markers, check ticks and envelopes: small, short-lived, pooled by key. */
export interface Effects {
  ring(agentId: string, doorX: number, on: boolean): void;
  /** ring -> check (200 ms reveal) at a door, then clears itself. */
  tick(doorX: number, agentId: string): void;
  marker(key: string, x: number, y: number): void;
  clearMarker(key: string): void;
  destroy(): void;
}

const MARKER_HOLD_MS = 20000;

export function createEffects(ctx: VillageContext): Effects {
  const g = ctx.layout.groundY;
  const sc = ctx.scene;
  interface Ring {
    doorX: number;
    imgs: Phaser.GameObjects.Image[];
    label?: Phaser.GameObjects.Text;
    tws: Phaser.Tweens.Tween[];
  }
  const rings = new Map<string, Ring>();
  const markers = new Map<
    string,
    { img: Phaser.GameObjects.Image; timer: Phaser.Time.TimerEvent }
  >();
  // everything that fades out or is timed on its own: destroy() kills these so nothing outlives the module
  const temp = new Set<Phaser.GameObjects.GameObject>();
  const tws = new Set<Phaser.Tweens.Tween>();
  const timers = new Set<Phaser.Time.TimerEvent>();

  const track = (t: Phaser.Tweens.Tween): Phaser.Tweens.Tween => {
    tws.add(t);
    t.once('complete', () => tws.delete(t));
    return t;
  };
  const delay = (ms: number, fn: () => void): void => {
    const t = sc.time.delayedCall(ms, () => {
      timers.delete(t);
      fn();
    });
    timers.add(t);
  };
  /** Fade objects out over 150 ms, then destroy them; tracked so destroy() can cut it short. */
  const fadeOut = (objs: Phaser.GameObjects.GameObject[]): void => {
    sc.tweens.killTweensOf(objs);
    objs.forEach((o) => temp.add(o));
    track(
      tween(
        ctx,
        objs,
        { alpha: 0 },
        {
          ms: 150,
          onComplete: () =>
            objs.forEach((o) => {
              temp.delete(o);
              o.destroy();
            }),
        },
      ),
    );
  };
  const killObj = (o: Phaser.GameObjects.GameObject): void => {
    sc.tweens.killTweensOf(o);
    o.destroy();
  };

  const stopRing = (agentId: string) => {
    const r = rings.get(agentId);
    if (!r) return;
    r.tws.forEach((t) => t.stop());
    r.label?.destroy();
    fadeOut(r.imgs);
    rings.delete(agentId);
  };

  const buildRing = (doorX: number): Ring => {
    const mk = (frame: number) =>
      sc.add
        .image(snap(doorX), g - 1, 'mv-ring', frame)
        .setOrigin(0.5, 0.5)
        .setDepth(ctx.depth.props + 3);
    const entry: Ring = { doorX, imgs: [], tws: [] };
    if (ctx.calm) {
      // reduced motion: static ring plus the word "waiting" (design 8.11)
      const img = mk(1).setAlpha(0.7);
      entry.imgs.push(img);
      const label = pixelText(ctx, 'waiting', { color: 'wallLit', size: 9.333 }).setDepth(
        ctx.depth.worldUi,
      );
      label.setPosition(snap(doorX - label.width / 2), g - 18);
      entry.label = label;
    } else {
      // two ripples half a cycle apart (1.6 s loop each, scale 1 -> 1.15, alpha .6 -> 0): one is always visible
      [0, 800].forEach((d, i) => {
        const img = mk(i === 0 ? 1 : 2).setAlpha(0);
        entry.imgs.push(img);
        entry.tws.push(
          sc.tweens.add({
            targets: img,
            scaleX: { from: 1, to: 1.15 },
            scaleY: { from: 1, to: 1.15 },
            alpha: { from: 0.6, to: 0 },
            duration: 1600,
            delay: d,
            ease: ctx.motion.easeOut,
            repeat: -1,
          }),
        );
      });
    }
    return entry;
  };
  const dropRing = (r: Ring) => {
    r.tws.forEach((t) => t.stop());
    r.imgs.forEach(killObj);
    if (r.label) killObj(r.label);
  };

  // Calm is read live: switch every active ring between ripples and the static "waiting" ring
  const offCalm = ctx.bus.on('calm', () => {
    for (const [id, r] of [...rings]) {
      dropRing(r);
      rings.set(id, buildRing(r.doorX));
    }
  });

  return {
    ring(agentId, doorX, on) {
      if (!on) return stopRing(agentId);
      if (rings.has(agentId)) return;
      rings.set(agentId, buildRing(doorX));
    },
    tick(doorX, agentId) {
      stopRing(agentId);
      const ok = sc.add
        .image(snap(doorX), g - 1, 'mv-ring-ok')
        .setOrigin(0.5, 0.5)
        .setDepth(ctx.depth.props + 3)
        .setAlpha(0);
      const check = sc.add
        .image(snap(doorX), g - 3, 'mv-check')
        .setOrigin(0.5, 1)
        .setDepth(ctx.depth.actorFx + 1);
      temp.add(ok).add(check);
      const w = check.width;
      const h = check.height;
      if (ctx.calm) {
        ok.setAlpha(1);
      } else {
        // left-to-right reveal in 200 ms ease-out (a crop, not a move)
        check.setCrop(0, 0, 0, h);
        const prog = { p: 0 };
        track(
          sc.tweens.add({
            targets: prog,
            p: 1,
            duration: 200,
            ease: ctx.motion.easeOut,
            onUpdate: () => {
              if (check.active) check.setCrop(0, 0, Math.ceil(w * prog.p), h);
            },
          }),
        );
        track(tween(ctx, ok, { alpha: 1 }, { ms: 120 }));
      }
      delay(1500, () => fadeOut([ok, check]));
    },
    marker(key, x, y) {
      this.clearMarker(key);
      const img = sc.add
        .image(snap(x), snap(y), 'mv-alert')
        .setOrigin(0.5, 1)
        .setDepth(ctx.depth.actorFx + 3);
      if (ctx.calm) {
        img.setAlpha(1); // static marker, no pop
      } else {
        img.setAlpha(0).setScale(0.7);
        track(tween(ctx, img, { alpha: 1, scaleX: 1, scaleY: 1 }, { ms: 350, ease: spring }));
      }
      const timer = sc.time.delayedCall(MARKER_HOLD_MS, () => this.clearMarker(key));
      markers.set(key, { img, timer });
    },
    clearMarker(key) {
      const m = markers.get(key);
      if (!m) return;
      m.timer.remove(false);
      markers.delete(key);
      fadeOut([m.img]);
    },
    destroy() {
      offCalm();
      for (const r of rings.values()) dropRing(r);
      rings.clear();
      timers.forEach((t) => t.remove(false));
      timers.clear();
      tws.forEach((t) => t.stop());
      tws.clear();
      for (const m of markers.values()) {
        m.timer.remove(false);
        killObj(m.img);
      }
      markers.clear();
      temp.forEach(killObj);
      temp.clear();
    },
  };
}
