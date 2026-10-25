import type Phaser from 'phaser';
import type { Glow, VillageContext } from '../world/api';
import { agentName } from '../adapter';
import { parseAgentId } from '@squad/core';
import { ensureLocked, ensureOwnLit } from './locked';
import type { LockedScene } from './locked';
import { pixelText, tween } from './util';

export const HOME_SLOTS = ['home-1', 'home-2', 'home-3'] as const;

/** Geometry of house_hut_*.png (128x133, ground anchor (64,132)); mirrored when the house is flipped. */
const HUT = {
  w: 128,
  h: 133,
  door: -22,
  doorY: -14,
  window: { x: 38, y: -61 },
  chimney: { x: 40, y: -122 },
  sign: { x: -42, y: -107, w: 28, h: 9 },
};

interface Home {
  slotId: string;
  slotX: number;
  flip: boolean;
  doorX: number;
  house: Phaser.GameObjects.Image;
  lock?: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  glow?: Glow;
  smoke?: Phaser.GameObjects.Sprite;
  owner?: string;
  mine: boolean;
  lit: boolean;
  relock?: Phaser.Time.TimerEvent;
}

export interface HomeManager {
  /** Door x for a student agent (assigns a house on first sight). */
  doorXFor(agentId: string): number | undefined;
  setLit(agentId: string, lit: boolean): void;
  /** ring turned into a check: the padlock opens for a moment, then locks again. */
  unlockFor(agentId: string): void;
  isMine(agentId: string): boolean;
  update(): void;
  destroy(): void;
}

export function createHomes(ctx: VillageContext): HomeManager {
  const L = ctx.layout;
  const g = L.groundY;
  const homes: Home[] = [];
  const byAgent = new Map<string, Home>();
  const scene = ctx.scene as unknown as LockedScene;
  ensureLocked(scene, 'mv-hut-dark', 'mv-hut-locked-dim', false);
  ensureLocked(scene, 'mv-hut-lit', 'mv-hut-locked-lit', true);
  ensureOwnLit(scene, 'mv-hut-lit', 'mv-hut-own-lit');

  if (!ctx.scene.anims.exists('mv-smoke')) {
    ctx.scene.anims.create({
      key: 'mv-smoke',
      frames: ctx.scene.anims.generateFrameNumbers('mv-smoke', { start: 0, end: 7 }),
      frameRate: 5,
      repeat: -1,
    });
  }

  HOME_SLOTS.forEach((id, i) => {
    let slot;
    try {
      slot = L.slot(id);
    } catch {
      return;
    }
    const flip = i === 2; // one mirrored house breaks the repetition
    const sgn = flip ? -1 : 1;
    const house = ctx.scene.add
      .image(slot.x, g + 1, 'mv-hut-locked-dim')
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.buildings)
      .setFlipX(flip);
    const label = pixelText(ctx, '', { color: 'ink', size: 9.333 })
      .setDepth(ctx.depth.props)
      .setVisible(false);
    homes.push({
      slotId: id,
      slotX: slot.x,
      flip,
      doorX: slot.x + sgn * HUT.door,
      house,
      label,
      mine: false,
      lit: false,
    });
  });

  const tex = (h: Home) =>
    h.mine
      ? h.lit
        ? 'mv-hut-own-lit'
        : 'mv-hut-dark'
      : h.lit
        ? 'mv-hut-locked-lit'
        : 'mv-hut-locked-dim';

  const lockFor = (h: Home) => {
    if (h.lock) return h.lock;
    h.lock = ctx.scene.add
      .image(h.doorX, g - 26, 'mv-padlock')
      .setOrigin(0.5, 0.5)
      .setDepth(ctx.depth.props + 1);
    return h.lock;
  };

  const assign = (agentId: string, mine: boolean): Home | undefined => {
    const have = byAgent.get(agentId);
    if (have) return have;
    // the viewer gets home-1; others in order; overflow shares the last house (limit: three households)
    const free = homes.find((h) => !h.owner && (mine ? h === homes[0] : h !== homes[0] || !me));
    const h = free ?? (mine ? homes[0] : homes[homes.length - 1]);
    if (!h) return undefined;
    if (!h.owner) {
      h.owner = agentId;
      h.mine = mine;
      h.house.setTexture(tex(h));
      const text = mine ? 'Home' : agentName(agentId).slice(0, 8);
      const sgn = h.flip ? -1 : 1;
      const s = HUT.sign;
      h.label.setText(text);
      const cx = h.slotX + sgn * (s.x + s.w / 2);
      h.label
        .setPosition(Math.round(cx - h.label.width / 2), g + s.y)
        .setVisible(true)
        .setAlpha(0);
      tween(ctx, h.label, { alpha: 1 }, { ms: 200 });
      if (!mine) lockFor(h);
    }
    byAgent.set(agentId, h);
    return h;
  };

  const me = ctx.me ? `student:${ctx.me}` : undefined;
  if (me) assign(me, true);
  for (const a of ctx.agents.list())
    if (parseAgentId(a.id).kind === 'student') assign(a.id, a.id === me);

  const addWindowGlow = (h: Home) => {
    const sgn = h.flip ? -1 : 1;
    h.glow = ctx.lighting.addGlow({
      x: h.slotX + sgn * HUT.window.x,
      y: g + HUT.window.y,
      radius: 18,
      color: 0xffc857,
      intensity: 0.8,
      flicker: !ctx.calm,
    });
    h.glow.setIntensity(1);
  };

  const syncSmoke = () => {
    for (const h of homes) {
      if (!h.smoke?.visible) continue;
      if (ctx.calm && h.smoke.anims.isPlaying) h.smoke.anims.stop();
      else if (!ctx.calm && !h.smoke.anims.isPlaying) h.smoke.play('mv-smoke');
    }
  };

  // Calm is read live: the glow handle has no flicker setter, so a lit window gets a fresh glow
  const offCalm = ctx.bus.on('calm', () => {
    for (const h of homes) {
      if (h.glow && h.lit) {
        h.glow.destroy();
        addWindowGlow(h);
      }
    }
    syncSmoke();
  });

  const applyLit = (h: Home, lit: boolean) => {
    if (h.lit === lit) return;
    h.lit = lit;
    h.house.setTexture(tex(h));
    const sgn = h.flip ? -1 : 1;
    if (lit) {
      if (h.glow) h.glow.setIntensity(1);
      else addWindowGlow(h);
      if (!h.smoke) {
        h.smoke = ctx.scene.add
          .sprite(h.slotX + sgn * HUT.chimney.x - 6, g + HUT.chimney.y - 35, 'mv-smoke', 0)
          .setOrigin(0, 0)
          .setDepth(ctx.depth.buildings + 1);
      }
      h.smoke.setVisible(true);
      if (ctx.calm) h.smoke.anims.stop();
      else h.smoke.play('mv-smoke');
    } else {
      h.glow?.setIntensity(0);
      h.smoke?.anims.stop();
      h.smoke?.setVisible(false);
    }
  };

  return {
    doorXFor(agentId) {
      return assign(agentId, agentId === me)?.doorX;
    },
    setLit(agentId, lit) {
      const h =
        byAgent.get(agentId) ??
        (parseAgentId(agentId).kind === 'student' ? assign(agentId, agentId === me) : undefined);
      if (h) applyLit(h, lit);
    },
    unlockFor(agentId) {
      const h = byAgent.get(agentId);
      if (!h?.lock) return;
      const lock = h.lock;
      h.relock?.remove(false);
      lock.setTexture('mv-padlock-open');
      h.relock = ctx.scene.time.delayedCall(1600, () => lock.setTexture('mv-padlock'));
    },
    isMine: (agentId) => byAgent.get(agentId)?.mine ?? false,
    update: syncSmoke,
    destroy() {
      offCalm();
      for (const h of homes) {
        ctx.scene.tweens.killTweensOf([h.label, h.house]);
        h.relock?.remove(false);
        h.glow?.destroy();
        h.smoke?.destroy();
        h.house.destroy();
        h.lock?.destroy();
        h.label.destroy();
      }
    },
  };
}
