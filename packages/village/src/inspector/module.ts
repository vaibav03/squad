import Phaser from 'phaser';
import type { ModuleInstance, SceneModule, VillageContext } from '../world/api';
import { COLOR, PAL } from '../mesh-view/palette';
import { clip, pixelText, snap } from '../mesh-view/util';
import type { InspectorStore } from './store';

/** Minimum touch/click target for a character, in CSS px (phone tap target rule). */
const MIN_TARGET_CSS = 44;
const FOLLOW_EVERY_MS = 500;
const FOLLOW_SLACK = 0.22;
const LINK_MS = 4000;

interface Spot {
  readonly id: string;
  readonly sprite: Phaser.GameObjects.Sprite;
}
interface ActorList {
  list(): Array<{ id: string; sprite: Phaser.GameObjects.Sprite }>;
}

/**
 * Agent Inspector, canvas side (order 500): every character sprite (agents and the viewer) is a hit
 * target of at least 44 CSS px with a pointer cursor, a hover outline and name tag, a ring under the
 * selected one, optional camera follow, and the `I` key to cycle characters. It only reads and writes
 * the InspectorStore; the DOM panel lives in the host.
 */
export function createInspectorView(ctx: VillageContext, store: InspectorStore): ModuleInstance {
  const scene = ctx.scene;
  const gfx = scene.add.graphics().setDepth(ctx.depth.actorFx);
  const ring = scene.add.graphics().setDepth(ctx.depth.actors - 1);
  const tag = pixelText(ctx, '', { color: 'cloudHi', size: 9.333 })
    .setShadow(1, 1, PAL.ink, 0, false, true)
    .setDepth(ctx.depth.worldUi)
    .setVisible(false);
  const wired = new WeakSet<object>();
  let hover: Spot | undefined;
  let zoomSeen = -1;
  let sideFor: string | null = null;
  let followAt = 0;
  const me = ctx.me ? `student:${ctx.me}` : undefined;

  const spots = (): Spot[] => {
    const out: Spot[] = [];
    const actors = ctx.registry.get('mv.actors') as ActorList | undefined;
    for (const a of actors?.list() ?? []) out.push({ id: a.id, sprite: a.sprite });
    if (me) out.push({ id: me, sprite: ctx.player.sprite });
    return out;
  };
  const spriteOf = (id: string): Phaser.GameObjects.Sprite | undefined =>
    spots().find((s) => s.id === id)?.sprite;

  const hitRect = (sp: Phaser.GameObjects.Sprite): Phaser.Geom.Rectangle => {
    const zoom = Math.max(1, ctx.game.scale.zoom || 1);
    const min = Math.ceil(MIN_TARGET_CSS / zoom);
    const w = Math.max(sp.width, min);
    const h = Math.max(sp.height, min);
    return new Phaser.Geom.Rectangle((sp.width - w) / 2, (sp.height - h) / 2, w, h);
  };

  const wire = (s: Spot) => {
    if (wired.has(s.sprite)) return;
    wired.add(s.sprite);
    s.sprite.setData('inspect', s.id);
    s.sprite.setInteractive(hitRect(s.sprite), Phaser.Geom.Rectangle.Contains);
    s.sprite.on('pointerover', () => {
      hover = s;
      ctx.game.canvas.style.cursor = 'pointer';
    });
    s.sprite.on('pointerout', () => {
      if (hover === s) hover = undefined;
      ctx.game.canvas.style.cursor = '';
    });
    s.sprite.on('pointerdown', () => {
      store.select(s.id);
      // the stage keeps the keyboard so Esc and arrows keep working
      stage()?.focus({ preventScroll: true });
    });
  };
  const stage = () => ctx.game.canvas.closest<HTMLElement>('.sqv-stage');

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== stage() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code !== 'KeyI') return;
    e.preventDefault();
    const next = store.cycle(store.selected, e.shiftKey ? -1 : 1);
    if (next) {
      store.select(next);
      const v = store.view(next);
      if (v) ctx.bus.emit('announce', `${v.name}. ${v.headline}`);
    }
  };
  const st = stage();
  st?.addEventListener('keydown', onKey);
  // A click on empty ground does nothing to the player; it only closes the inspector.
  const onGround = (_p: Phaser.Input.Pointer, over?: Phaser.GameObjects.GameObject[]) => {
    if (over?.some((o) => o.getData?.('inspect'))) return;
    if (store.selected !== null) {
      store.select(null);
      store.setFollow(false);
    }
  };
  scene.input.on('pointerdown', onGround);

  const drawOutline = (sp: Phaser.GameObjects.Sprite, color: number) => {
    const b = sp.getBounds();
    const x = snap(b.x) - 1;
    const y = snap(b.y) - 1;
    gfx.lineStyle(1, color, 1);
    gfx.strokeRect(x + 0.5, y + 0.5, Math.round(b.width) + 1, Math.round(b.height) + 1);
  };

  return {
    update(now) {
      for (const s of spots()) wire(s);
      const zoom = ctx.game.scale.zoom;
      if (zoom !== zoomSeen) {
        zoomSeen = zoom;
        for (const s of spots()) if (s.sprite.input) s.sprite.input.hitArea = hitRect(s.sprite);
      }
      gfx.clear();
      ring.clear();
      const calm = ctx.calm;
      // selected ring under the feet (static in Calm mode; slow pulse otherwise)
      const selSprite = store.selected ? spriteOf(store.selected) : undefined;
      if (store.selected !== sideFor) {
        // Dock the panel on the side opposite the selected character (decided once per selection).
        sideFor = store.selected;
        if (selSprite) {
          const cam = scene.cameras.main;
          store.setSide((selSprite.x - cam.scrollX) / cam.width > 0.5 ? 'left' : 'right');
        }
      }
      if (selSprite) {
        const pulse = calm ? 1 : 0.75 + 0.25 * Math.sin(now / 420);
        const x = snap(selSprite.x);
        const y = snap(ctx.layout.groundY) + 1;
        ring.fillStyle(COLOR.glow, 0.18 * pulse);
        ring.fillEllipse(x, y, 30, 8);
        ring.lineStyle(1, COLOR.glow, pulse);
        ring.strokeEllipse(x, y, 30, 8);
      }
      // while two agents are communicating, a soft link between their sprites (fades; static in Calm mode)
      const t = Date.now();
      for (const l of store.links()) {
        const sa = spriteOf(l.a);
        const sb = spriteOf(l.b);
        if (!sa || !sb || sa === sb || sa.alpha < 0.5 || sb.alpha < 0.5) continue;
        const k = Math.max(0, 1 - (t - l.at) / LINK_MS);
        const a = calm ? 0.4 : 0.55 * (1 - (1 - k) * (1 - k));
        const y = snap(sa.y) - 26;
        const mx = snap((sa.x + sb.x) / 2);
        gfx.lineStyle(1, COLOR.violet, a);
        gfx.lineBetween(snap(sa.x), y, snap(sb.x), snap(sb.y) - 26);
        gfx.fillStyle(COLOR.violet, a);
        gfx.fillRect(mx - 1, y - 1, 3, 3);
      }
      // hover outline and name tag
      if (hover && hover.sprite.active && hover.sprite.alpha > 0) {
        drawOutline(hover.sprite, COLOR.cloudHi);
        const v = store.view(hover.id);
        const text = v ? `${v.name}: ${clip(v.headline, 34)}` : hover.id;
        tag.setText(text).setVisible(true);
        const cam = scene.cameras.main;
        const x = Math.min(
          Math.max(hover.sprite.x - tag.width / 2, cam.scrollX + 2),
          cam.scrollX + cam.width - 2 - tag.width,
        );
        tag.setPosition(snap(x), snap(hover.sprite.getBounds().y - tag.height - 3));
        gfx.fillStyle(COLOR.ink, 0.88);
        gfx.fillRect(
          snap(tag.x) - 3,
          snap(tag.y) - 2,
          Math.ceil(tag.width) + 6,
          Math.ceil(tag.height) + 4,
        );
        gfx.lineStyle(1, COLOR.hillMid, 1);
        gfx.strokeRect(
          snap(tag.x) - 2.5,
          snap(tag.y) - 1.5,
          Math.ceil(tag.width) + 5,
          Math.ceil(tag.height) + 3,
        );
      } else tag.setVisible(false);
      // follow: ease the camera toward the selected character (whole pixels, no zoom change)
      if (store.follow && selSprite && now - followAt > FOLLOW_EVERY_MS) {
        followAt = now;
        const cam = scene.cameras.main;
        const centre = cam.scrollX + cam.width / 2;
        if (selSprite === ctx.player.sprite) {
          if (ctx.camera.mode !== 'follow') ctx.camera.setMode('follow');
        } else if (Math.abs(selSprite.x - centre) > cam.width * FOLLOW_SLACK)
          void ctx.camera.panTo(Math.round(selSprite.x), { holdMs: 1500 });
      }
    },
    destroy() {
      st?.removeEventListener('keydown', onKey);
      scene.input.off('pointerdown', onGround);
      ctx.game.canvas.style.cursor = '';
      gfx.destroy();
      ring.destroy();
      tag.destroy();
    },
  };
}

const mod: SceneModule = {
  id: 'inspector',
  order: 500,
  create(ctx) {
    const store = ctx.registry.get('inspector') as InspectorStore | undefined;
    if (!store) return;
    return createInspectorView(ctx, store);
  },
};
export default mod;
