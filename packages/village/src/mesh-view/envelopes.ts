import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';
import type { Actor } from './actors';
import { snap, tween } from './util';

const ABOVE_HEAD = 33;
const MAX_PINNED = 3;
/** An envelope that never gets a walkTo (recipient only, dropped event) fades away instead of floating forever. */
const UNGLIDED_MS = 20000;

export interface Envelope {
  readonly id: string;
  readonly to: string;
  carrier?: Actor;
  sprite: Phaser.GameObjects.Sprite;
  popped: boolean;
  /** Set once glide() has started; an envelope that never glides is cleaned up after UNGLIDED_MS. */
  gliding?: boolean;
  idle?: Phaser.Time.TimerEvent;
}

export interface EnvelopeManager {
  spawn(id: string, to: string, at: { x: number; y: number }, carrier?: Actor): Envelope;
  get(id: string): Envelope | undefined;
  /** Hand-off glide (320 ms ease-in-out, +60 ms stagger) to a point; then fade (agent) or rest (pinned). */
  glide(
    env: Envelope,
    to: { x: number; y: number },
    o: { rest: boolean; staggerIndex?: number; onDone?: () => void },
  ): void;
  update(): void;
  destroy(): void;
}

export function createEnvelopes(ctx: VillageContext): EnvelopeManager {
  const sc = ctx.scene;
  const all = new Map<string, Envelope>();
  const pinned: Envelope[] = [];
  if (!sc.anims.exists('mv-env-pop')) {
    sc.anims.create({
      key: 'mv-env-pop',
      frames: sc.anims.generateFrameNumbers('mv-env-pop', { start: 0, end: 3 }),
      frameRate: 22,
      repeat: 0,
    });
  }

  const destroyEnv = (e: Envelope) => {
    e.idle?.remove(false);
    sc.tweens.killTweensOf(e.sprite);
    e.sprite.destroy();
    if (all.get(e.id) === e) all.delete(e.id);
    const pi = pinned.indexOf(e);
    if (pi >= 0) pinned.splice(pi, 1);
  };

  return {
    spawn(id, to, at, carrier) {
      const dup = all.get(id);
      if (dup) destroyEnv(dup);
      const sprite = sc.add
        .sprite(snap(at.x), snap(at.y), 'mv-env-pop', 0)
        .setOrigin(0.5, 1)
        .setDepth(ctx.depth.actorFx + 2);
      const env: Envelope = { id, to, sprite, popped: false, ...(carrier ? { carrier } : {}) };
      all.set(id, env);
      env.idle = sc.time.delayedCall(UNGLIDED_MS, () => {
        if (env.gliding || all.get(id) !== env) return;
        tween(ctx, sprite, { alpha: 0 }, { ms: 200, onComplete: () => destroyEnv(env) });
      });
      if (ctx.calm) {
        // reduced motion: no pop; the envelope fades in at the door
        sprite.setTexture('mv-envelope').setAlpha(0);
        tween(ctx, sprite, { alpha: 1 }, { ms: 120 });
        env.popped = true;
      } else {
        sprite.play('mv-env-pop');
        sprite.once('animationcomplete', () => {
          sprite.setTexture('mv-envelope');
          env.popped = true;
        });
      }
      return env;
    },
    get: (id) => all.get(id),
    glide(env, to, o) {
      delete env.carrier;
      env.gliding = true;
      env.idle?.remove(false);
      const done = () => {
        if (o.rest) {
          pinned.push(env);
          while (pinned.length > MAX_PINNED) {
            const old = pinned.shift()!;
            sc.tweens.killTweensOf(old.sprite);
            tween(ctx, old.sprite, { alpha: 0 }, { ms: 200, onComplete: () => destroyEnv(old) });
          }
        } else {
          tween(ctx, env.sprite, { alpha: 0 }, { ms: 200, onComplete: () => destroyEnv(env) });
        }
        o.onDone?.();
      };
      if (ctx.calm) {
        // reduced motion: fade out at the source, fade in at the destination
        tween(
          ctx,
          env.sprite,
          { alpha: 0 },
          {
            ms: 120,
            onComplete: () => {
              env.sprite.setPosition(snap(to.x), snap(to.y));
              tween(ctx, env.sprite, { alpha: 1 }, { ms: 120, onComplete: done });
            },
          },
        );
        return;
      }
      tween(
        ctx,
        env.sprite,
        { x: to.x, y: to.y },
        {
          ms: 320,
          ease: ctx.motion.easeInOut,
          delay: 60 * (o.staggerIndex ?? 0),
          onUpdate: () => env.sprite.setPosition(snap(env.sprite.x), snap(env.sprite.y)),
          onComplete: done,
        },
      );
    },
    update() {
      for (const e of all.values()) {
        if (e.carrier)
          e.sprite.setPosition(snap(e.carrier.sprite.x), snap(e.carrier.sprite.y - ABOVE_HEAD));
      }
    },
    destroy() {
      for (const e of [...all.values()]) destroyEnv(e);
      all.clear();
      pinned.length = 0;
    },
  };
}
