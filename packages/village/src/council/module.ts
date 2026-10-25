import Phaser from 'phaser';
import type { ModuleInstance, SceneModule, VillageContext } from '../world/api';
import { COLOR, PAL } from '../mesh-view/palette';
import { pixelText, snap } from '../mesh-view/util';
import {
  ARROW_PACKET_SIZE,
  ARROW_WIDTH,
  ARROW_WINDOW_MS,
  arcPoints,
  arcAt,
  arrowHead,
  planArrows,
  type Pt,
} from './arrows';
import type { CouncilBoardStore } from './store';

interface ActorList {
  list(): Array<{ id: string; sprite: Phaser.GameObjects.Sprite }>;
}

const HEAD_Y = 26;

/**
 * Council message arrows in the village (order 510, next to the inspector at 500): a soft violet arc with a pixel
 * arrowhead and a kind word between the sprites of two agents that are exchanging messages right now, at most 3
 * at a time, one 3 px packet per arrow. Calm mode draws the static arc and label only. Reads the board store.
 */
export function createCouncilArrows(ctx: VillageContext, board: CouncilBoardStore): ModuleInstance {
  const scene = ctx.scene;
  const gfx = scene.add.graphics().setDepth(ctx.depth.actorFx);
  const labels = [0, 1, 2].map(() =>
    pixelText(ctx, '', { color: 'cloudHi', size: 8 })
      .setShadow(1, 1, PAL.ink, 0, false, true)
      .setDepth(ctx.depth.worldUi)
      .setVisible(false),
  );
  const spriteOf = (id: string): Phaser.GameObjects.Sprite | undefined =>
    (ctx.registry.get('mv.actors') as ActorList | undefined)?.list().find((a) => a.id === id)
      ?.sprite;

  return {
    update() {
      gfx.clear();
      labels.forEach((l) => l.setVisible(false));
      const links = board.links(ARROW_WINDOW_MS);
      if (links.length === 0) return;
      const positions = new Map<string, Pt>();
      for (const l of links)
        for (const id of [l.from, l.to]) {
          const sp = spriteOf(id);
          if (sp && sp.alpha >= 0.5) positions.set(id, { x: snap(sp.x), y: snap(sp.y) - HEAD_Y });
        }
      const arrows = planArrows(links, positions, { calm: ctx.calm, now: Date.now() });
      arrows.forEach((a, i) => {
        const p0 = positions.get(a.from)!;
        const p1 = positions.get(a.to)!;
        gfx.lineStyle(ARROW_WIDTH, COLOR.violet, a.alpha);
        gfx.beginPath();
        arcPoints(p0, p1).forEach((p, j) =>
          j === 0 ? gfx.moveTo(snap(p.x), snap(p.y)) : gfx.lineTo(snap(p.x), snap(p.y)),
        );
        gfx.strokePath();
        const [tip, l, r] = arrowHead(p0, p1);
        gfx.fillStyle(COLOR.violet, a.alpha);
        gfx.fillTriangle(snap(tip.x), snap(tip.y), snap(l.x), snap(l.y), snap(r.x), snap(r.y));
        if (a.packetT !== null) {
          const q = arcAt(p0, p1, a.packetT);
          gfx.fillStyle(COLOR.cloudHi, Math.min(1, a.alpha + 0.3));
          gfx.fillRect(snap(q.x) - 1, snap(q.y) - 1, ARROW_PACKET_SIZE, ARROW_PACKET_SIZE);
        }
        const mid = arcAt(p0, p1, 0.5);
        const t = labels[i]!;
        t.setText(a.label)
          .setAlpha(Math.min(1, a.alpha + 0.2))
          .setPosition(snap(mid.x - t.width / 2), snap(mid.y - t.height - 2))
          .setVisible(true);
      });
    },
    destroy() {
      gfx.destroy();
      labels.forEach((l) => l.destroy());
    },
  };
}

const mod: SceneModule = {
  id: 'council-arrows',
  order: 510,
  create(ctx) {
    const board = ctx.registry.get('councilBoard') as CouncilBoardStore | undefined;
    if (!board) return;
    return createCouncilArrows(ctx, board);
  },
};
export default mod;
