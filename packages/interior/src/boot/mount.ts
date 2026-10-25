import type Phaser from 'phaser';
import type { CameraMode, InteriorHandle, MountOptions } from '../api';
import type { InteriorScene } from '../scene/interior-scene';
import { joinUrl, loadManifest } from '../assets/manifest';
import { parsePropsDef, parseTiledMap } from '../tilemap/parse';
import { computeScale } from './scaler';

const REDUCED = '(prefers-reduced-motion: reduce)';
const INK = '#070f1f';

async function fetchJson(url: string): Promise<unknown | undefined> {
  const r = await fetch(url);
  if (!r.ok) return undefined;
  return r.json();
}

/** Builds the DOM shell and boots Phaser (imported lazily so SSR / Node never touch `window`). */
export function mountInterior(
  a: HTMLElement | MountOptions,
  b?: Omit<MountOptions, 'parent'>,
): InteriorHandle {
  const opts: MountOptions =
    a instanceof HTMLElement ? { ...(b as Omit<MountOptions, 'parent'>), parent: a } : a;
  const assetBase = (opts.assetBase ?? '/assets').replace(/\/+$/, '');
  const log = (m: string, e?: unknown) => console.warn(`[interior] ${m}`, e ?? '');
  let destroyed = false;
  let game: Phaser.Game | undefined;
  let scene: InteriorScene | undefined;
  let ro: ResizeObserver | undefined;
  let vis: (() => void) | undefined;
  const calm = {
    value: !!opts.calm || (typeof matchMedia === 'function' && matchMedia(REDUCED).matches),
  };
  let pendingCamera: CameraMode | undefined;
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
  root.className = 'sqi-root';
  root.style.cssText = `position:absolute;inset:0;background:${INK};overflow:hidden;display:flex;align-items:center;justify-content:center`;
  const stage = document.createElement('div');
  stage.className = 'sqi-stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute(
    'aria-label',
    'Squad campus: a walkable indoor campus where your study agents live. Arrow keys or WASD walk, Enter interacts. The agent list and the overlays give text access.',
  );
  stage.style.cssText =
    'position:relative;outline:none;flex:none;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden';
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText = 'position:absolute;inset:0';
  const status = document.createElement('div');
  status.textContent = 'Loading the campus';
  status.setAttribute('role', 'status');
  status.style.cssText =
    "position:absolute;inset:0;display:grid;place-items:center;color:#8fb0c6;font:16px 'Jersey 10','Courier New',monospace;pointer-events:none;z-index:4";
  stage.append(canvasHost, status);
  root.appendChild(stage);
  parent.appendChild(root);

  const applySize = (g?: Phaser.Game) => {
    const r = parent.getBoundingClientRect();
    const s = computeScale(r.width || 960, r.height || 540, window.devicePixelRatio || 1);
    stage.style.width = `${s.cssW}px`;
    stage.style.height = `${s.cssH}px`;
    if (g) {
      g.scale.setZoom(s.cssPerPx);
      g.scale.resize(s.logicalW, s.logicalH);
      g.canvas.style.imageRendering = 'pixelated';
    }
    return s;
  };

  const fail = (e: unknown) => {
    log('boot failed', e);
    status.textContent = 'The campus could not load. Reload the page to try again.';
    status.style.color = '#e0485a';
    onFail(e);
  };

  void (async () => {
    try {
      const manifest = await loadManifest(assetBase, { fetchJson }, log);
      const mapPath = manifest.maps[opts.map ?? 'demo'];
      if (!mapPath) throw new Error(`unknown map "${opts.map ?? 'demo'}"`);
      const [mapJson, propsJson, phaserMod, sceneMod, hudMod] = await Promise.all([
        fetchJson(joinUrl(assetBase, mapPath)),
        fetchJson(joinUrl(assetBase, manifest.props.def)),
        import('phaser'),
        import('../scene/interior-scene'),
        import('../scene/hud'),
      ]);
      if (destroyed) return;
      if (!mapJson || !propsJson) throw new Error('map or props definition missing');
      const map = parseTiledMap(mapJson);
      const propsDef = parsePropsDef(propsJson);
      const Phaser = phaserMod.default;
      const s = applySize();
      const hud = hudMod.createHud(stage, { show: opts.hud !== false, assetBase });
      scene = new sceneMod.InteriorScene({
        opts,
        assetBase,
        manifest,
        map,
        propsDef,
        stage,
        hud,
        calm,
        log,
        onReady: () => {
          status.remove();
          if (pendingCamera) scene?.setCameraMode(pendingCamera);
          onReady();
        },
      });
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: canvasHost,
        width: s.logicalW,
        height: s.logicalH,
        backgroundColor: INK,
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
        fps: { target: 60, smoothStep: false },
        input: {
          keyboard: false,
          gamepad: false,
          mouse: { preventDefaultWheel: false },
          touch: { capture: true },
        },
        scene: [scene],
      });
      game.canvas.style.imageRendering = 'pixelated';
      game.canvas.setAttribute('aria-hidden', 'true');
      ro = new ResizeObserver(() => applySize(game));
      ro.observe(parent);
      vis = () => {
        if (!game) return;
        if (document.hidden) game.loop.sleep();
        else game.loop.wake();
      };
      document.addEventListener('visibilitychange', vis);
      matchMedia(REDUCED).addEventListener?.('change', (e) => {
        if (e.matches) calm.value = true;
      });
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
      try {
        game?.destroy(true);
      } catch (e) {
        log('destroy', e);
      }
      game = undefined;
      root.remove();
      document.querySelectorAll('style[data-sqi-hud]').forEach((n) => n.remove());
    },
    setCalm(v) {
      calm.value = v;
    },
    overlayClosed() {
      scene?.overlayClosed();
    },
    setCamera(m) {
      if (scene) scene.setCameraMode(m);
      else pendingCamera = m;
    },
    debug: {
      game: () => game,
      world: () => scene?.debugApi(),
      fps: () => game?.loop.actualFps ?? 0,
    },
  };
}
