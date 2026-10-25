import type Phaser from 'phaser';
import type { WorldScene } from '../scene-manager/world-scene';
import { getRoomSession } from '../scenes/rooms';
import { fetchManifest } from './assets';
import { computeScale } from './scaler';

/** Height of the phone agent dock (chip row plus its gaps), reserved under the canvas on narrow layouts. */
const PHONE_DOCK_PX = 76;
import { loadAdapter, loadModules } from '../scene-manager/modules';
import { type CameraMode, type MountOptions, type VillageHandle } from '../world/api';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Builds the DOM shell and boots Phaser (imported lazily so SSR / Node never touch `window`). */
export function mountVillage(
  a: HTMLElement | MountOptions,
  b?: Omit<MountOptions, 'parent'>,
): VillageHandle {
  const opts: MountOptions =
    a instanceof HTMLElement ? { ...(b as Omit<MountOptions, 'parent'>), parent: a } : a;
  const assetBase = opts.assetBase ?? '/assets';
  const log = (m: string, e?: unknown) => console.warn(`[village] ${m}`, e ?? '');
  let destroyed = false;
  let game: Phaser.Game | undefined;
  let scene: WorldScene | undefined;
  let ro: ResizeObserver | undefined;
  let vis: (() => void) | undefined;
  let mq: MediaQueryList | undefined;
  let restoreAdd: (() => void) | undefined;
  const phaserVis: Array<[string, EventListener, boolean]> = [];
  let onMq: ((e: MediaQueryListEvent) => void) | undefined;
  const calm = {
    value: !!opts.calm || (typeof matchMedia === 'function' && matchMedia(REDUCED).matches),
  };
  let pendingCamera: CameraMode | undefined;
  let zoomExtra = 0;
  let onReady!: () => void;
  let onFail!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    onReady = res;
    onFail = rej;
  });
  ready.catch(() => {});

  const parent = opts.parent;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const root = document.createElement('div');
  root.className = 'sqv-root';
  root.style.cssText =
    'position:absolute;inset:0;box-sizing:border-box;background:linear-gradient(180deg,#060d1f 0%,#0b1d38 100%);overflow:hidden;display:flex;align-items:center;justify-content:center';
  const stage = document.createElement('div');
  stage.className = 'sqv-stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute(
    'aria-label',
    'Squad Village: a walkable night village where your study agents live. Use the agent list and the controls for text access.',
  );
  stage.style.cssText =
    'position:relative;outline:none;flex:none;touch-action:none;user-select:none;-webkit-user-select:none';
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText = 'position:absolute;inset:0';
  const status = document.createElement('div');
  status.textContent = 'Loading the village';
  status.setAttribute('role', 'status');
  status.style.cssText =
    "position:absolute;inset:0;display:grid;place-items:center;color:#8fb0c6;font:16px 'Courier New',monospace;pointer-events:none;z-index:4";
  stage.append(canvasHost, status);
  root.appendChild(stage);
  parent.appendChild(root);

  const applySize = (g?: Phaser.Game) => {
    const r = parent.getBoundingClientRect();
    // Phones: the agent dock is a row under the picture. Reserve it so the picture sits right above it, and
    // let the leftover height become extra sky at the top (same colour as the sky's top edge) instead of a gap
    // between the picture and the dock.
    const narrow = (r.width || 960) < 900;
    const dock = narrow ? PHONE_DOCK_PX : 0;
    root.style.alignItems = narrow ? 'flex-end' : 'center';
    root.style.paddingBottom = `${dock}px`;
    root.style.background = narrow
      ? 'var(--sqv-sky-top,#0b1d38)'
      : 'linear-gradient(180deg,#060d1f 0%,#0b1d38 100%)';
    const s = computeScale(
      r.width || 960,
      (r.height || 540) - dock,
      window.devicePixelRatio || 1,
      zoomExtra,
    );
    stage.style.width = `${s.cssW}px`;
    stage.style.height = `${s.cssH}px`;
    if (g) {
      g.scale.setZoom(s.cssPerPx);
      g.scale.resize(s.logicalW, s.logicalH);
      const c = g.canvas;
      c.style.imageRendering = 'pixelated';
      // Phaser's ScaleManager (mode NONE) can keep the previous canvas CSS size after a zoom/size change (rotating a
      // phone from portrait to landscape left a 195x270 picture in an 844x244 stage). The stage size is the truth.
      c.style.width = `${s.cssW}px`;
      c.style.height = `${s.cssH}px`;
    }
    return s;
  };

  // Reserve the stage box now (before Phaser and the manifest load) so the HUD and canvas never shift it.
  applySize();

  const fail = (e: unknown) => {
    log('boot failed', e);
    status.textContent = 'The village could not load. Reload the page to try again.';
    status.style.color = '#e0485a';
    onFail(e);
  };

  void (async () => {
    try {
      const [{ default: Phaser }, { WorldScene }, manifestSpecs, modules, adapter] =
        await Promise.all([
          import('phaser'),
          import('../scene-manager/world-scene'),
          fetchManifest(assetBase, log),
          loadModules(opts.skipModules ?? [], log),
          loadAdapter(log),
        ]);
      if (destroyed) return;
      const s = applySize();
      scene = new WorldScene({
        opts,
        assetBase,
        manifestSpecs,
        modules,
        adapter,
        stage,
        calm,
        log,
        onReady: () => {
          status.remove();
          const bus = scene!.ctx.bus;
          const sync = (m: CameraMode) => {
            const z = m === 'zoom' ? 1 : 0;
            if (z !== zoomExtra) {
              zoomExtra = z;
              applySize(game);
            }
          };
          bus.on('cameraMode', sync);
          sync(scene!.ctx.camera.mode);
          onReady();
          if (pendingCamera) scene?.cameraSet(pendingCamera);
        },
      });
      // Phaser (3.90) adds a document 'visibilitychange' listener it never removes, which keeps every destroyed game
      // alive. Record it while the game boots so destroy() can remove it.
      const nativeAdd = document.addEventListener;
      document.addEventListener = function (this: Document, t: string, fn: unknown, o?: unknown) {
        if (/visibilitychange$/i.test(t)) phaserVis.push([t, fn as EventListener, o as boolean]);
        return (nativeAdd as (...a: unknown[]) => void).call(this, t, fn, o);
      } as typeof document.addEventListener;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: canvasHost,
        width: s.logicalW,
        height: s.logicalH,
        backgroundColor: '#0b1d38',
        banner: false,
        autoFocus: false,
        disableContextMenu: true,
        scale: { mode: Phaser.Scale.NONE, zoom: s.cssPerPx },
        render: {
          pixelArt: true,
          antialias: false,
          roundPixels: true,
          powerPreference: 'high-performance',
        },
        // a file that never answers fails after 30 s (the loader reports it and carries on) instead of holding the
        // whole village behind "Opening the village" forever
        loader: { timeout: 30_000 },
        fps: { target: 60, smoothStep: false },
        input: {
          keyboard: false,
          // Clicks on DOM panels over the world (room info, council, chat dock) must not reach the world's pointer
          // handlers: with window events on, a click on a panel hit the interior veil and made the player leave the room.
          windowEvents: false,
          gamepad: false,
          mouse: { preventDefaultWheel: false },
          touch: { capture: true },
        },
        scene: [scene],
      });
      restoreAdd = () => {
        document.addEventListener = nativeAdd;
        restoreAdd = undefined;
      };
      game.events.once('ready', () => restoreAdd?.());
      game.canvas.style.imageRendering = 'pixelated';
      game.canvas.setAttribute('aria-hidden', 'true');
      ro = new ResizeObserver(() => applySize(game));
      ro.observe(parent);
      // Pause the loop when hidden; resume without catching up (scene clamps delta too).
      vis = () => {
        if (!game) return;
        if (document.hidden) game.loop.sleep();
        else game.loop.wake();
      };
      document.addEventListener('visibilitychange', vis);
      mq = matchMedia(REDUCED);
      onMq = (e) => {
        if (e.matches) {
          calm.value = true;
          scene?.ctx.bus.emit('calm', true);
        }
      };
      mq.addEventListener?.('change', onMq);
    } catch (e) {
      if (!destroyed) fail(e);
    }
  })();

  return {
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ro?.disconnect();
      if (vis) document.removeEventListener('visibilitychange', vis);
      if (mq && onMq) mq.removeEventListener?.('change', onMq);
      restoreAdd?.();
      for (const [t, fn, o] of phaserVis) document.removeEventListener(t, fn, o);
      phaserVis.length = 0;
      // Phaser frees its GL context only when the canvas is garbage collected. Browsers allow ~16 live contexts, so
      // ten Village <-> Home round trips used to exhaust them and blank the world. Release it explicitly.
      const gl = (game?.renderer as { gl?: WebGLRenderingContext } | undefined)?.gl;
      try {
        game?.destroy(true);
      } catch (e) {
        log('destroy', e);
      }
      try {
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        /* context already gone */
      }
      game = undefined;
      root.remove();
      document.querySelectorAll('style[data-sqv-hud]').forEach((n) => n.remove());
    },
    setCamera(m) {
      if (scene?.ctx) scene.cameraSet(m);
      else pendingCamera = m;
    },
    setCalm(v) {
      calm.value = v;
      scene?.ctx?.bus.emit('calm', v);
    },
    overlayClosed() {
      scene?.ctx?.bus.emit('overlayClosed', undefined);
    },
    async openRoom(slot, o) {
      // the village may still be loading when a council starts: wait for its door, at most 10 s
      const find = () => scene?.ctx?.interactables.list().find((i) => i.id === `enter-${slot}`);
      for (let n = 0; n < 40 && !find(); n++) await new Promise((r) => setTimeout(r, 250));
      const ctx = scene?.ctx;
      const door = find();
      if (!ctx || !door || door.enabled?.() === false) return false;
      // walk to the door (Calm and reduced motion: enter at once), but never wait more than 6 s
      if (!o.calm && !calm.value)
        await Promise.race([ctx.player.walkTo(door.x), new Promise((r) => setTimeout(r, 6000))]);
      // the interior art may still be loading (enter is then a no-op): retry until we are inside, at most 10 s
      for (let n = 0; n < 20; n++) {
        if (getRoomSession()?.snapshot().entered === slot) return true;
        door.onActivate();
        await new Promise((r) => setTimeout(r, 500));
      }
      return getRoomSession()?.snapshot().entered === slot;
    },
    debug: { game: () => game, ctx: () => scene?.ctx, fps: () => game?.loop.actualFps ?? 0 },
  };
}
