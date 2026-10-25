import { fetchManifest } from './assets';
import { computeScale } from './scaler';
import { loadAdapter, loadModules } from '../scene-manager/modules';
import { type CameraMode, type MountOptions, type VillageHandle } from '../world/api';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Builds the DOM shell and boots Phaser (imported lazily so SSR / Node never touch `window`). */
export function mountVillage(a: HTMLElement | MountOptions, b?: Omit<MountOptions, 'parent'>): VillageHandle {
  const opts: MountOptions = a instanceof HTMLElement ? { ...(b as Omit<MountOptions, 'parent'>), parent: a } : a;
  const assetBase = opts.assetBase ?? '/assets';
  const log = (m: string, e?: unknown) => console.warn(`[village] ${m}`, e ?? '');
  let destroyed = false;
  let game: import('phaser').Game | undefined;
  let scene: import('../scene-manager/world-scene').WorldScene | undefined;
  let ro: ResizeObserver | undefined;
  let vis: (() => void) | undefined;
  let mq: MediaQueryList | undefined;
  const calm = { value: !!opts.calm || (typeof matchMedia === 'function' && matchMedia(REDUCED).matches) };
  let pendingCamera: CameraMode | undefined;
  let onReady!: () => void;
  let onFail!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => { onReady = res; onFail = rej; });
  ready.catch(() => {});

  const parent = opts.parent;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const root = document.createElement('div');
  root.className = 'sqv-root';
  root.style.cssText = 'position:absolute;inset:0;background:#0b1d38;overflow:hidden;display:flex;align-items:center;justify-content:center';
  const stage = document.createElement('div');
  stage.className = 'sqv-stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', 'Squad Village: a walkable night village where your study agents live. Use the agent list and the controls for text access.');
  stage.style.cssText = 'position:relative;outline:none;flex:none;touch-action:none;user-select:none;-webkit-user-select:none';
  const canvasHost = document.createElement('div');
  canvasHost.style.cssText = 'position:absolute;inset:0';
  const status = document.createElement('div');
  status.textContent = 'Loading the village';
  status.setAttribute('role', 'status');
  status.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:#8fb0c6;font:16px 'Courier New',monospace;pointer-events:none;z-index:4";
  stage.append(canvasHost, status);
  root.appendChild(stage);
  parent.appendChild(root);

  const applySize = (g?: import('phaser').Game) => {
    const r = parent.getBoundingClientRect();
    const s = computeScale(r.width || 960, r.height || 540, window.devicePixelRatio || 1);
    stage.style.width = `${s.cssW}px`;
    stage.style.height = `${s.cssH}px`;
    if (g) {
      g.scale.setZoom(s.cssPerPx);
      g.scale.resize(s.logicalW, s.logicalH);
      const c = g.canvas;
      c.style.imageRendering = 'pixelated';
    }
    return s;
  };

  const fail = (e: unknown) => {
    log('boot failed', e);
    status.textContent = 'The village could not load. Reload the page to try again.';
    status.style.color = '#e0485a';
    onFail(e);
  };

  void (async () => {
    try {
      const [{ default: Phaser }, { WorldScene }, manifestSpecs, modules, adapter] = await Promise.all([
        import('phaser'),
        import('../scene-manager/world-scene'),
        fetchManifest(assetBase, log),
        loadModules(opts.skipModules ?? [], log),
        loadAdapter(log),
      ]);
      if (destroyed) return;
      const s = applySize();
      scene = new WorldScene({
        opts, assetBase, manifestSpecs, modules, adapter, stage, calm, log,
        onReady: () => { status.remove(); onReady(); if (pendingCamera) scene?.cameraSet(pendingCamera); },
      });
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
        render: { pixelArt: true, antialias: false, roundPixels: true, powerPreference: 'high-performance' },
        fps: { target: 60, smoothStep: false },
        input: { keyboard: false, gamepad: false, mouse: { preventDefaultWheel: false }, touch: { capture: true } },
        scene: [scene],
      });
      game.canvas.style.imageRendering = 'pixelated';
      game.canvas.setAttribute('aria-hidden', 'true');
      ro = new ResizeObserver(() => applySize(game));
      ro.observe(parent);
      // Pause the loop when hidden; resume without catching up (scene clamps delta too).
      vis = () => { if (!game) return; if (document.hidden) game.loop.sleep(); else game.loop.wake(); };
      document.addEventListener('visibilitychange', vis);
      mq = matchMedia(REDUCED);
      mq.addEventListener?.('change', (e) => { if (e.matches) { calm.value = true; scene?.ctx.bus.emit('calm', true); } });
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
      try { game?.destroy(true); } catch (e) { log('destroy', e); }
      game = undefined;
      root.remove();
      document.querySelectorAll('style[data-sqv-hud]').forEach((n) => n.remove());
    },
    setCamera(m) { if (scene?.ctx) scene.cameraSet(m); else pendingCamera = m; },
    setCalm(v) { calm.value = v; scene?.ctx?.bus.emit('calm', v); },
    overlayClosed() { scene?.ctx?.bus.emit('overlayClosed', undefined); },
    debug: { game: () => game, ctx: () => scene?.ctx, fps: () => game?.loop.actualFps ?? 0 },
  };
}
