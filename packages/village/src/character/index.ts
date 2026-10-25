import type Phaser from 'phaser';
import type {
  AssetSpec,
  Interactable,
  MotionTokens,
  PlayerApi,
  VillageBus,
  WorldLayout,
  WorldTime,
} from '../world/api';
import { DEPTH, GROUND_Y } from '../world/api';
import { nearestInteractable, tabOrder } from '../world/interact';
import { WalkSim } from './walk';
import { CHAR_ATLAS, ensureCharacterAnims } from './anims';
export { ensureCharacterAnims } from './anims';

export const ASSETS: AssetSpec[] = [
  {
    type: 'atlas',
    key: CHAR_ATLAS,
    path: 'assets/pixel/composed/characters/atlas.png',
    atlasPath: 'assets/pixel/composed/characters/atlas.json',
  },
];

export interface PlayerDeps {
  layout: WorldLayout;
  time: WorldTime;
  motion: MotionTokens;
  calm: () => boolean;
  registry: Phaser.Data.DataManager;
  bus: VillageBus;
}
export type PlayerImpl = PlayerApi & {
  setIntent(dir: -1 | 0 | 1): void;
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
};

const MARGIN = 16;

export function createPlayer(scene: Phaser.Scene, d: PlayerDeps): PlayerImpl {
  ensureCharacterAnims(scene);
  const cast = (d.registry.get('playerCast') as string | undefined) ?? 'student';

  const saved = d.registry.get('playerX') as number | undefined;
  const start = saved ?? d.layout.slot('spawn').x;
  const sim = new WalkSim(start, MARGIN, d.layout.width - MARGIN, d.motion.easeOut);

  const sprite = scene.add
    .sprite(Math.round(start), GROUND_Y, CHAR_ATLAS, `${cast}/idle/0`)
    .setOrigin(0.5, 31 / 32)
    .setDepth(DEPTH.actors + 1);
  if (!scene.textures.exists('sqv-shadow')) {
    const t = scene.textures.createCanvas('sqv-shadow', 18, 6);
    if (t) {
      const c = t.getContext();
      c.fillStyle = 'rgba(7,15,31,0.42)';
      c.fillRect(3, 0, 12, 6);
      c.fillRect(1, 1, 16, 4);
      t.refresh();
    }
  }
  const shadow = scene.add
    .image(Math.round(start), GROUND_Y, 'sqv-shadow')
    .setOrigin(0.5, 0.5)
    .setDepth(DEPTH.actors - 1);

  let locks = 0;
  let animKey = '';
  let fade: { t: number; to: number } | null = null;
  let lastSave = 0;

  const api: PlayerImpl = {
    get x() {
      return sim.x;
    },
    get facing() {
      return sim.facing;
    },
    get isWalking() {
      return sim.walking;
    },
    sprite,
    walkTo(x, opts) {
      const target = opts?.stopWithin
        ? x - Math.sign(x - sim.x) * Math.min(opts.stopWithin, Math.abs(x - sim.x))
        : x;
      if (d.calm()) {
        sim.teleport(target); // reduced motion: teleport with a 120 ms fade
        fade = { t: 0, to: target };
        return Promise.resolve(true);
      }
      return new Promise<boolean>((res) => sim.walkTo(target, res));
    },
    teleport(x) {
      sim.teleport(x);
    },
    lockInput() {
      locks++;
      sim.setIntent(0);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          locks = Math.max(0, locks - 1);
        }
      };
    },
    setIntent(dir) {
      if (locks === 0) sim.setIntent(dir);
      else sim.setIntent(0);
    },
    update(t, dt) {
      sim.step(dt);
      const x = sim.renderX;
      sprite.setPosition(x, GROUND_Y);
      shadow.setPosition(x, GROUND_Y - 1);
      sprite.setFlipX(sim.facing === 'left');
      const key = sim.walking
        ? cast === 'student'
          ? 'student-walk-fast'
          : `${cast}-walk`
        : `${cast}-idle`;
      if (key !== animKey) {
        animKey = key;
        sprite.play(key, true);
      }
      if (fade) {
        fade.t += dt;
        const k = Math.min(1, fade.t / 120);
        sprite.setAlpha(0.25 + 0.75 * k);
        if (k >= 1) fade = null;
      }
      if (t - lastSave > 400) {
        lastSave = t;
        d.registry.set('playerX', Math.round(sim.x));
      }
    },
    destroy() {
      sprite.destroy();
      shadow.destroy();
    },
  };
  return api;
}

/* ---------- input ---------- */
export interface InputDeps {
  player: PlayerImpl;
  camera: Phaser.Cameras.Scene2D.Camera;
  layout: WorldLayout;
  interactables: { list(): Interactable[] };
  bus: VillageBus;
  focusEl: HTMLElement;
}
export interface InputImpl {
  update(timeMs: number, deltaMs: number): void;
  destroy(): void;
}

const CONTROLS =
  'Arrow keys or A and D walk. Enter opens the nearest place. Tab cycles places. I inspects the next character; click a character to see what it is doing. Escape leaves. Walking is keyboard-only.';

export function createInput(scene: Phaser.Scene, d: InputDeps): InputImpl {
  const down = new Set<string>();
  let overlayOpen = false;
  let inside: string | null = null;
  let tabIdx = -1;
  let pendingActivate: Interactable | null = null;
  const unsubs: Array<() => void> = [];

  const walkKeys = new Set(['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD']);
  const dirNow = (): -1 | 0 | 1 => {
    const l = down.has('ArrowLeft') || down.has('KeyA');
    const r = down.has('ArrowRight') || down.has('KeyD');
    return l === r ? 0 : l ? -1 : 1;
  };
  const apply = () => d.player.setIntent(overlayOpen ? 0 : dirNow());

  const goActivate = (it: Interactable) => {
    pendingActivate = null;
    if (Math.abs(it.x - d.player.x) <= it.radius) {
      it.onActivate();
      return;
    }
    pendingActivate = it;
    void d.player.walkTo(it.x).then((ok) => {
      if (ok && pendingActivate === it) {
        pendingActivate = null;
        it.onActivate();
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (overlayOpen || e.target !== d.focusEl) return; // HUD buttons keep their own keys
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (walkKeys.has(e.code)) {
      e.preventDefault();
      pendingActivate = null;
      down.add(e.code);
      apply();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      const list = tabOrder(d.interactables.list());
      const target = tabIdx >= 0 ? list[tabIdx] : nearestInteractable(list, d.player.x);
      if (target) {
        e.preventDefault();
        goActivate(target);
      }
    } else if (e.code === 'Tab') {
      const list = tabOrder(d.interactables.list());
      const next = tabIdx + (e.shiftKey ? -1 : 1);
      if (next < 0 || next >= list.length) {
        tabIdx = -1;
        return;
      } // let focus leave the canvas at the ends
      e.preventDefault();
      tabIdx = next;
      const it = list[next]!;
      d.bus.emit('announce', `${it.label}. Press Enter to go there.`);
    } else if (e.code === 'Escape') {
      if (inside) d.bus.emit('leave', { slotId: inside });
    } else if (e.key === '?') {
      d.bus.emit('announce', CONTROLS);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (down.delete(e.code)) apply();
  };
  const onBlur = () => {
    down.clear();
    apply();
  };
  d.focusEl.addEventListener('keydown', onKeyDown);
  d.focusEl.addEventListener('keyup', onKeyUp);
  d.focusEl.addEventListener('blur', onBlur);

  unsubs.push(
    d.bus.on('overlay', (o) => {
      if (o.type !== 'closeOverlay') {
        overlayOpen = true;
        down.clear();
        apply();
      } else overlayOpen = false;
    }),
  );
  unsubs.push(
    d.bus.on('overlayClosed', () => {
      overlayOpen = false;
      d.focusEl.focus({ preventScroll: true });
    }),
  );
  unsubs.push(
    d.bus.on('enter', (e) => {
      inside = e.slotId;
    }),
  );
  unsubs.push(
    d.bus.on('leave', () => {
      inside = null;
    }),
  );

  // Tap / hold to walk (touch + mouse). Continuous while the pointer is held and moving.
  const marker = scene.add.graphics().setDepth(DEPTH.actorFx);
  let markerT = -1;
  let markerX = 0;
  let held = false;
  const isTouch = (p: Phaser.Input.Pointer): boolean => !!p.wasTouch;
  const toWorld = (p: Phaser.Input.Pointer) => d.camera.getWorldPoint(p.x, p.y).x;
  const onDown = (p: Phaser.Input.Pointer, over?: Phaser.GameObjects.GameObject[]) => {
    if (overlayOpen) return;
    // A character was hit: the inspector handles it, the player does not walk there.
    if (over?.some((o) => o.getData?.('inspect'))) {
      d.focusEl.focus({ preventScroll: true });
      return;
    }
    d.focusEl.focus({ preventScroll: true });
    // Laptop: walking is keyboard-only. A mouse click on the ground never moves the player (touch keeps tap-to-walk).
    if (!isTouch(p)) return;
    held = true;
    const x = toWorld(p);
    const hit = nearestInteractable(
      d.interactables.list().map((i) => ({ ...i, radius: Math.max(i.radius, 18) })),
      x,
    );
    pendingActivate = null;
    if (hit) {
      const real = d.interactables.list().find((i) => i.id === hit.id)!;
      goActivate(real);
    } else void d.player.walkTo(Math.round(x));
    markerT = 0;
    markerX = Math.round(x);
  };
  const onMove = (p: Phaser.Input.Pointer) => {
    if (held && p.isDown && !overlayOpen && !pendingActivate) {
      void d.player.walkTo(Math.round(toWorld(p)));
    }
  };
  const onUp = () => {
    held = false;
  };
  scene.input.on('pointerdown', onDown);
  scene.input.on('pointermove', onMove);
  scene.input.on('pointerup', onUp);
  scene.input.on('pointerupoutside', onUp);

  return {
    update(_t, dt) {
      if (markerT >= 0) {
        markerT += dt;
        const k = Math.min(1, markerT / 160);
        marker.clear();
        marker.lineStyle(1, 0xfff2c4, 1 - k);
        const r = 2 + Math.round(k * 5);
        marker.strokeEllipse(markerX, GROUND_Y + 1, r * 2, r);
        if (k >= 1) {
          markerT = -1;
          marker.clear();
        }
      }
    },
    destroy() {
      d.focusEl.removeEventListener('keydown', onKeyDown);
      d.focusEl.removeEventListener('keyup', onKeyUp);
      d.focusEl.removeEventListener('blur', onBlur);
      scene.input.off('pointerdown', onDown);
      scene.input.off('pointermove', onMove);
      scene.input.off('pointerup', onUp);
      scene.input.off('pointerupoutside', onUp);
      unsubs.forEach((u) => u());
      marker.destroy();
    },
  };
}
