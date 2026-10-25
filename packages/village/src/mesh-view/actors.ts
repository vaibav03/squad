import type Phaser from 'phaser';
import { parseAgentId } from '@squad/core';
import type { VillageContext } from '../world/api';
import { CAST_ATLAS } from './assets';
import { agentName } from '../adapter';
import { pixelText, snap, tween } from './util';

const WALK_PX_PER_S = 36; // constant speed like the player, never eased (spec 08 row 3)
const STOP_PX = 4;
const STOP_MS = 80;

/** Student agents must not look like the viewer's own character (the 'student' cast): stable pick by first sight. */
const AGENT_CASTS = ['ta', 'freshman', 'expert'] as const;

export function personaFor(
  agentId: string,
  studentCast: (id: string) => string = () => 'freshman',
): string {
  const { kind, ref } = parseAgentId(agentId);
  switch (kind) {
    case 'dean':
      return 'dean';
    case 'expert':
      return 'expert';
    case 'mediator':
      return 'mediator';
    case 'council': {
      const k = ['council-chill', 'council-hard', 'council-balance'];
      let h = 0;
      for (const c of ref ?? '') h = (h * 31 + c.charCodeAt(0)) % 997;
      return k[h % k.length]!;
    }
    case 'student':
      return studentCast(agentId);
    default:
      return 'freshman';
  }
}

export interface Actor {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly home: number;
  x(): number;
  /** Queue a walk; resolves on arrival (or immediately after the teleport fade in calm mode). */
  walkTo(x: number): Promise<void>;
  face(dir: 'left' | 'right'): void;
  /** Tag follows the sprite while the actor moves. */
  showTag(on: boolean): void;
  update(): void;
  destroy(): void;
}

export interface ActorManager {
  get(agentId: string, homeX: number): Actor;
  peek(agentId: string): Actor | undefined;
  update(): void;
  destroy(): void;
}

function ensureShadow(ctx: VillageContext): void {
  const sc = ctx.scene;
  if (sc.textures.exists('mv-shadow')) return;
  const t = sc.textures.createCanvas('mv-shadow', 18, 6);
  if (!t) return;
  const c = t.getContext();
  c.fillStyle = 'rgba(7,15,31,0.42)'; // same soft contact shadow as the player
  c.fillRect(3, 0, 12, 6);
  c.fillRect(1, 1, 16, 4);
  t.refresh();
}

function ensureAnims(ctx: VillageContext, persona: string): void {
  const a = ctx.scene.anims;
  const mk = (name: string, count: number, fps: number) => {
    const key = `mv-${persona}-${name}`;
    if (a.exists(key)) return;
    a.create({
      key,
      frames: Array.from({ length: count }, (_, i) => ({
        key: CAST_ATLAS.key,
        frame: `${persona}/${name}/${i}`,
      })),
      frameRate: fps,
      repeat: -1,
    });
  };
  mk('idle', 2, 2);
  mk('walk', 4, 8);
  mk('talk', 2, 8);
}

export function createActors(ctx: VillageContext): ActorManager {
  const g = ctx.layout.groundY;
  const actors = new Map<string, Actor>();
  const seen: string[] = [];
  const studentCast = (id: string) => {
    let i = seen.indexOf(id);
    if (i < 0) i = seen.push(id) - 1;
    return AGENT_CASTS[i % AGENT_CASTS.length]!;
  };

  const create = (id: string, homeX: number): Actor => {
    const persona = personaFor(id, studentCast);
    ensureAnims(ctx, persona);
    const sprite = ctx.scene.add
      .sprite(homeX, g, CAST_ATLAS.key, `${persona}/idle/0`)
      .setOrigin(0.5, 31 / 32)
      .setDepth(ctx.depth.actors)
      .setAlpha(0);
    sprite.play(`mv-${persona}-idle`);
    ensureShadow(ctx);
    const shadow = ctx.scene.add
      .image(homeX, g, 'mv-shadow')
      .setOrigin(0.5, 0.5)
      .setDepth(ctx.depth.actors - 1)
      .setAlpha(0);
    tween(ctx, [sprite, shadow], { alpha: 1 }, { ms: 180 });
    const tag = pixelText(ctx, agentName(id), { color: 'wallLit', size: 9.333 })
      .setDepth(ctx.depth.actorFx)
      .setVisible(false);
    let chain: Promise<void> = Promise.resolve();
    let moving: Phaser.Tweens.Tween | undefined;
    let tagOn = false;
    const placeTag = () => tag.setPosition(snap(sprite.x - tag.width / 2), snap(sprite.y + 3));

    const walk = (to: number) =>
      new Promise<void>((resolve) => {
        const from = sprite.x;
        const dist = Math.abs(to - from);
        if (dist < 1) return resolve();
        const dir = to > from ? 1 : -1;
        sprite.setFlipX(dir < 0);
        if (ctx.calm) {
          // reduced motion: 60 ms out, snap, 60 ms in (docs/specs/08 row 3)
          tween(
            ctx,
            sprite,
            { alpha: 0 },
            {
              ms: 60,
              onComplete: () => {
                sprite.x = snap(to);
                tween(ctx, sprite, { alpha: 1 }, { ms: 60, onComplete: () => resolve() });
              },
            },
          );
          return;
        }
        sprite.play(`mv-${persona}-walk`, true);
        const lead = Math.max(0, dist - STOP_PX);
        const finish = () => {
          sprite.play(`mv-${persona}-idle`, true);
          resolve();
        };
        const stop = () => {
          moving = tween(
            ctx,
            sprite,
            { x: to },
            {
              ms: STOP_MS,
              ease: ctx.motion.easeOut,
              onUpdate: () => (sprite.x = snap(sprite.x)),
              onComplete: () => {
                sprite.x = snap(to);
                finish();
              },
            },
          );
        };
        if (lead < 1) return stop();
        moving = tween(
          ctx,
          sprite,
          { x: from + dir * lead },
          {
            ms: (lead / WALK_PX_PER_S) * 1000,
            ease: (t) => t,
            onUpdate: () => (sprite.x = snap(sprite.x)),
            onComplete: stop,
          },
        );
      });

    const actor: Actor = {
      id,
      sprite,
      home: homeX,
      x: () => sprite.x,
      walkTo(x) {
        chain = chain.then(() => walk(x));
        return chain;
      },
      face(dir) {
        sprite.setFlipX(dir === 'left');
      },
      showTag(on) {
        tagOn = on;
        tag.setVisible(on);
        if (on) placeTag();
      },
      update() {
        shadow.setPosition(sprite.x, g).setAlpha(sprite.alpha);
        if (tagOn) placeTag();
      },
      destroy() {
        moving?.stop();
        shadow.destroy();
        tag.destroy();
        sprite.destroy();
      },
    };
    return actor;
  };

  return {
    get(agentId, homeX) {
      let a = actors.get(agentId);
      if (!a) actors.set(agentId, (a = create(agentId, homeX)));
      return a;
    },
    peek: (id) => actors.get(id),
    update() {
      for (const a of actors.values()) a.update();
    },
    destroy() {
      for (const a of actors.values()) a.destroy();
      actors.clear();
    },
  };
}
