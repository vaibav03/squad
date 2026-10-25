import type Phaser from 'phaser';
import type { Glow, VillageContext } from '../world/api';
import { agentName } from '../adapter';
import { parseAgentId } from '@squad/core';
import { HOUSE_H, HOUSE_STYLES, HOUSE_W, WINDOW_L, WINDOW_R } from './textures';
import { COLOR, PAL } from './palette';
import { pixelText, snap, tween } from './util';

export const HOME_SLOTS = ['home-1', 'home-2', 'home-3'] as const;

interface Home {
  slotId: string;
  x: number;
  style: number;
  house: Phaser.GameObjects.Image;
  lock?: Phaser.GameObjects.Image;
  plate: Phaser.GameObjects.Container;
  plateText: Phaser.GameObjects.Text;
  plateBg: Phaser.GameObjects.Graphics;
  glows: Glow[];
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
  destroy(): void;
}

function drawPlate(g: Phaser.GameObjects.Graphics, w: number): void {
  g.clear();
  g.fillStyle(COLOR.ink, 1).fillRect(0, 0, w, 9);
  g.fillStyle(COLOR.wood, 1).fillRect(1, 1, w - 2, 7);
  g.fillStyle(COLOR.woodLit, 1).fillRect(1, 1, w - 2, 1);
  g.fillStyle(COLOR.ink, 1).fillRect(2, 8, 1, 2).fillRect(w - 3, 8, 1, 2);
}

export function createHomes(ctx: VillageContext): HomeManager {
  const L = ctx.layout;
  const g = L.groundY;
  const homes: Home[] = [];
  const byAgent = new Map<string, Home>();

  HOME_SLOTS.forEach((id, i) => {
    let slot;
    try {
      slot = L.slot(id);
    } catch {
      return;
    }
    const style = i % HOUSE_STYLES.length;
    const house = ctx.scene.add
      .image(slot.x, g, `mesh-house-${style}-dim`)
      .setOrigin(0.5, 1)
      .setDepth(ctx.depth.buildings);
    const left = slot.x - HOUSE_W / 2;
    const top = g - HOUSE_H;
    const glows = [WINDOW_L, WINDOW_R].map((w) => {
      const glow = ctx.lighting.addGlow({ x: left + w.x + 5, y: top + w.y + 5, radius: 16, color: COLOR.glow, intensity: 0.7, flicker: true });
      glow.setIntensity(0);
      return glow;
    });
    const plateBg = ctx.scene.add.graphics();
    const plateText = pixelText(ctx, '', { color: 'wallLit' });
    const plate = ctx.scene.add.container(slot.x, top + 24, [plateBg, plateText]).setDepth(ctx.depth.props).setVisible(false);
    homes.push({ slotId: id, x: slot.door?.x ?? slot.x, style, house, plate, plateText, plateBg, glows, mine: false, lit: false });
  });

  const lockFor = (h: Home) => {
    if (h.lock) return h.lock;
    h.lock = ctx.scene.add
      .image(h.x, g - 17, 'mesh-lock-closed')
      .setOrigin(0.5, 0.5)
      .setDepth(ctx.depth.props + 1);
    return h.lock;
  };

  const assign = (agentId: string, mine: boolean): Home | undefined => {
    const have = byAgent.get(agentId);
    if (have) return have;
    // mine -> home-1; others in order; overflow shares the last house (documented limit: 3 households)
    const free = homes.find((h) => !h.owner && (mine ? h === homes[0] : true));
    const h = free ?? (mine ? homes[0] : homes[homes.length - 1]);
    if (!h) return undefined;
    if (!h.owner) {
      h.owner = agentId;
      h.mine = mine;
      const label = mine ? 'Home' : agentName(agentId).slice(0, 7);
      h.plateText.setText(label);
      const w = Math.max(18, Math.ceil(h.plateText.width) + 6);
      drawPlate(h.plateBg, w);
      h.plateText.setPosition(3, 0);
      h.plate.setX(snap(h.x - w / 2)).setVisible(true).setAlpha(0);
      tween(ctx, h.plate, { alpha: 1 }, { ms: 200 });
      if (!mine) lockFor(h);
    }
    byAgent.set(agentId, h);
    return h;
  };

  const me = ctx.me ? `student:${ctx.me}` : undefined;
  if (me) assign(me, true);
  for (const a of ctx.agents.list()) if (parseAgentId(a.id).kind === 'student') assign(a.id, a.id === me);

  const applyLit = (h: Home, lit: boolean) => {
    if (h.lit === lit) return;
    h.lit = lit;
    h.house.setTexture(`mesh-house-${h.style}-${lit ? 'lit' : 'dim'}`);
    h.glows.forEach((gl) => gl.setIntensity(lit ? 1 : 0));
  };

  return {
    doorXFor(agentId) {
      return assign(agentId, agentId === me)?.x;
    },
    setLit(agentId, lit) {
      const h = byAgent.get(agentId) ?? (parseAgentId(agentId).kind === 'student' ? assign(agentId, agentId === me) : undefined);
      if (h) applyLit(h, lit);
    },
    unlockFor(agentId) {
      const h = byAgent.get(agentId);
      if (!h?.lock) return;
      const lock = h.lock;
      h.relock?.remove(false);
      lock.setTexture('mesh-lock-open');
      h.relock = ctx.scene.time.delayedCall(1600, () => lock.setTexture('mesh-lock-closed'));
    },
    isMine: (agentId) => byAgent.get(agentId)?.mine ?? false,
    destroy() {
      for (const h of homes) {
        h.relock?.remove(false);
        h.glows.forEach((gl) => gl.destroy());
        h.house.destroy();
        h.lock?.destroy();
        h.plate.destroy();
      }
    },
  };
}
void PAL;
