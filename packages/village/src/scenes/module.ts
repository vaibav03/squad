import type { VillageEvent } from '@squad/core';
import { createAssetLib, type AssetLib, type ManifestAsset } from './assets';
import { DEFAULT_CTX, step, type SceneCtx, type SceneDef } from './contract';
import { eventChapter } from './model/events';
import { Raster } from './pixel/raster';
import { PLACEMENTS, chapterSlotFor, type Placement } from './registry';

/**
 * Phaser binding for the buildings half (docs/village-api.md section 2). Scenes are pure Raster
 * painters over the composed art; this module paints each into a canvas texture at its layout
 * slot (8 fps, only when the frame changes), feeds raw VillageEvents through each scene's own
 * mapping, and shows the 224x128 cutaway interior as a faded overlay while the player is inside.
 * It types the host structurally (no import of the world or Phaser) so this package builds alone.
 */

/* ---------- the slice of the world API this module uses ---------- */
interface Img {
  setOrigin(x: number, y: number): Img;
  setDepth(d: number): Img;
  setAlpha(a: number): Img;
  setVisible(v: boolean): Img;
  setScrollFactor(x: number, y?: number): Img;
  setPosition(x: number, y: number): Img;
  setInteractive(): Img;
  on(ev: string, fn: () => void): Img;
  destroy(): void;
}
interface CanvasTex {
  context: CanvasRenderingContext2D;
  refresh(): void;
}
interface HostScene {
  textures: {
    createCanvas(key: string, w: number, h: number): CanvasTex | null;
    exists(key: string): boolean;
    remove(key: string): unknown;
    get(key: string): { getSourceImage(): CanvasImageSource & { width: number; height: number } };
  };
  add: {
    image(x: number, y: number, key: string): Img;
    rectangle(x: number, y: number, w: number, h: number, color: number, alpha: number): Img;
  };
  input: {
    keyboard?: {
      on(ev: string, fn: () => void): unknown;
      off(ev: string, fn: () => void): unknown;
    } | null;
  };
  load: {
    image(key: string, url: string): unknown;
    once(ev: string, fn: () => void): unknown;
    start(): void;
    isLoading(): boolean;
  };
  scale: { width: number; height: number };
}
interface HostGlow {
  setIntensity(v: number): void;
  destroy(): void;
}
export interface HostCtx {
  scene: HostScene;
  layout: {
    groundY: number;
    slot(id: string): { x: number; w: number; door?: { x: number } };
  };
  depth: { buildings: number; lighting: number; worldUi: number };
  time: { clockHours: number };
  lighting: {
    addGlow(o: {
      x: number;
      y: number;
      radius: number;
      intensity?: number;
      flicker?: boolean;
    }): HostGlow;
  };
  agents: {
    register(i: {
      id: string;
      name: string;
      kind: 'student' | 'expert' | 'council' | 'dean' | 'mediator';
      slotId?: string;
    }): void;
  };
  player: { x: number; sprite: Img; lockInput(): () => void };
  assets: { url(repoPath: string): string };
  bus: {
    on(k: 'villageEvent', fn: (e: VillageEvent) => void): () => void;
    emit(k: 'enter' | 'leave', p: { slotId: string }): void;
    emit(k: 'announce', p: string): void;
  };
  interactables: {
    register(i: {
      id: string;
      x: number;
      radius: number;
      label: string;
      enabled?: () => boolean;
      onActivate(): void;
    }): () => void;
  };
  registry: { get(k: string): unknown; set(k: string, v: unknown): void };
  me: string | undefined;
  readonly calm: boolean;
  log(msg: string, extra?: unknown): void;
}
interface Instance {
  update?(timeMs: number, deltaMs: number): void;
  onCommand?(cmd: unknown): void;
  destroy?(): void;
}

/* ---------- assets in the browser: manifest images decoded to Rasters ---------- */
const KEY = (path: string): string => `sc:${path}`;

function toRaster(img: CanvasImageSource & { width: number; height: number }): Raster {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const r = new Raster(c.width, c.height);
  r.data.set(d.data);
  return r;
}

async function loadAssets(ctx: HostCtx): Promise<AssetLib> {
  const manifest = (await (await fetch(ctx.assets.url('assets/asset-manifest.json'))).json()) as {
    assets: ManifestAsset[];
  };
  const atlas = await (
    await fetch(ctx.assets.url('assets/pixel/composed/characters/atlas.json'))
  ).json();
  const paths = new Set<string>();
  for (const a of manifest.assets) {
    if (!/\/(buildings|ui|props|fx|characters)\//.test(a.file)) continue;
    paths.add(a.file);
    for (const v of Object.values(a.variants ?? {})) paths.add(v);
  }
  const { scene } = ctx;
  await new Promise<void>((resolve) => {
    let queued = 0;
    for (const p of paths) {
      if (scene.textures.exists(KEY(p))) continue;
      scene.load.image(KEY(p), ctx.assets.url(p));
      queued++;
    }
    if (queued === 0) return resolve();
    scene.load.once('complete', resolve);
    scene.load.start();
  });
  return createAssetLib(manifest, atlas, (p) =>
    toRaster(scene.textures.get(KEY(p)).getSourceImage()),
  );
}

/* ---------- the module ---------- */
interface Live {
  p: Placement;
  def: SceneDef<unknown>;
  state: unknown;
  x: number;
  tex: CanvasTex | null;
  key: string;
  image: Img;
  glow: HostGlow | null;
  lastHash: string;
  label: string;
  unregister: () => void;
}

const REPAINT_MS = 125;
const INT_W = 224;
const INT_H = 128;

function chapterTitle(id: string): string {
  const m = /(\d+)/.exec(id);
  return m ? `Chapter ${Number(m[1])}` : id.replace(/[-_]/g, ' ');
}

const mod = {
  id: 'scenes',
  order: 100,
  create(ctx: HostCtx): Instance {
    const { scene, layout, depth } = ctx;
    const lives: Live[] = [];
    const chapterSlots = new Map<string, string>();
    let assets: AssetLib | null = null;
    let now = 0;
    let acc = REPAINT_MS;
    let inside: Live | null = null;
    let releaseInput: (() => void) | null = null;
    let interiorImg: Img | null = null;
    let veil: Img | null = null;
    let interiorTex: CanvasTex | null = null;
    let fade = { from: 0, to: 0, since: 0, dur: 200 };
    let fading = false;
    let alphaNow = 0;
    let destroyed = false;

    const sceneCtx = (): SceneCtx => ({
      ...DEFAULT_CTX,
      viewer: ctx.me ?? '', // unknown viewer owns nothing: no mastery, no per-student marks
      hour: Math.floor(ctx.time.clockHours) % 24,
      squadSize: (ctx.registry.get('squadSize') as number | undefined) ?? 0, // unknown: aggregates stay hidden
    });

    function place(p: Placement, instance: string): Live {
      const slot = layout.slot(p.slotId);
      const def = p.def as unknown as SceneDef<unknown>;
      const key = `scene-${p.slotId}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, def.exterior.w, def.exterior.h);
      const image = scene.add
        .image(slot.x, layout.groundY + 1, key)
        .setOrigin(0.5, 1) // the sprite box is centred on its slot; the door may sit off-centre
        .setDepth(depth.buildings)
        .setVisible(false);
      const live: Live = {
        p,
        def,
        state: def.init({ instance, title: p.title }),
        x: slot.x,
        tex,
        key,
        image,
        glow: null,
        lastHash: '',
        label: def.describe(def.init({ instance, title: p.title })),
        unregister: () => {},
      };
      live.unregister = ctx.interactables.register({
        id: `enter-${p.slotId}`,
        x: Math.round(slot.x + def.door.x - def.exterior.w / 2),
        radius: 24,
        label: `Open ${(live.state as { title?: string }).title || p.title}`,
        enabled: () => (live.state as { access: string }).access !== 'locked',
        onActivate: () => enter(live),
      });
      lives.push(live);
      if (p.agent) {
        ctx.agents.register({
          id: p.agent,
          name: def.title,
          kind: p.agent.startsWith('council') ? 'council' : 'expert',
          slotId: p.slotId,
        });
      }
      return live;
    }

    PLACEMENTS.forEach((p, i) => place(p, p.chapter ? `ch${i + 1}` : p.slotId));

    function ensureInterior(): void {
      if (interiorImg) return;
      if (scene.textures.exists('scene-interior')) scene.textures.remove('scene-interior');
      interiorTex = scene.textures.createCanvas('scene-interior', INT_W, INT_H);
      const cx = Math.round(scene.scale.width / 2);
      const cy = Math.round(scene.scale.height / 2);
      veil = scene.add
        .rectangle(cx, cy, scene.scale.width, scene.scale.height, 0x070f1f, 0.88)
        .setScrollFactor(0)
        .setDepth(depth.lighting + 5)
        .setAlpha(0)
        .setVisible(false)
        .setInteractive()
        .on('pointerdown', leave);
      interiorImg = scene.add
        .image(cx - INT_W / 2, cy - INT_H / 2, 'scene-interior')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(depth.lighting + 6)
        .setAlpha(0)
        .setVisible(false);
    }

    function enter(live: Live): void {
      if (inside || !assets) return;
      ensureInterior();
      inside = live;
      live.state = live.def.onEnter?.(live.state, now) ?? live.state;
      releaseInput = ctx.player.lockInput();
      ctx.registry.set('playerX', ctx.player.x);
      ctx.player.sprite.setVisible(false);
      ctx.bus.emit('enter', { slotId: live.p.slotId });
      fade = { from: alphaNow, to: 1, since: now, dur: ctx.calm ? 120 : 200 };
      fading = true;
      if (assets)
        blit(
          interiorTex,
          live.def.paint(live.state, 'interior', { t: now, calm: ctx.calm, assets }),
        );
      veil?.setVisible(true);
      interiorImg?.setVisible(true);
      ctx.bus.emit('announce', `Inside ${live.def.describe(live.state)}`);
    }
    function leave(): void {
      if (!inside) return;
      const live = inside;
      inside = null;
      live.state = live.def.onExit?.(live.state, now) ?? live.state;
      fade = { from: alphaNow, to: 0, since: now, dur: ctx.calm ? 120 : 200 };
      fading = true;
      ctx.player.sprite.setVisible(true);
      releaseInput?.();
      releaseInput = null;
      ctx.bus.emit('leave', { slotId: live.p.slotId });
    }
    scene.input.keyboard?.on('keydown-ESC', leave);

    const offEvent = ctx.bus.on('villageEvent', (e: VillageEvent) => {
      const c = sceneCtx();
      const chapter = eventChapter(e);
      if (chapter && !chapterSlots.has(chapter)) {
        const slotId = chapterSlotFor(chapter, new Set(chapterSlots.values()));
        const live = lives.find((l) => l.p.slotId === slotId);
        if (slotId && live) {
          chapterSlots.set(chapter, slotId);
          live.state = live.def.init({ instance: chapter, title: chapterTitle(chapter) });
        }
      }
      for (const live of lives) {
        const before = live.state;
        live.state = step(live.def, live.state, e, c, now);
        if (live.state !== before && e.t === 'council.verdict') {
          ctx.bus.emit('announce', `Council verdict: ${e.text ?? ''}`.trim());
        }
        if (live.state !== before) live.label = live.def.describe(live.state);
      }
    });

    loadAssets(ctx)
      .then((a) => {
        if (!destroyed) assets = a;
      })
      .catch((err: unknown) => ctx.log('scenes: asset load failed', err));

    function blit(tex: CanvasTex | null, r: Raster): void {
      if (!tex) return;
      tex.context.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      tex.refresh();
    }

    return {
      update(t, dt) {
        now = t;
        if (!assets) return;
        acc += dt;
        const dirty = acc >= REPAINT_MS;
        if (dirty) acc = 0;
        const o = { t, calm: ctx.calm, assets };
        for (const live of lives) {
          if (!dirty && live.lastHash) continue;
          const r = live.def.paint(live.state, 'exterior', o);
          const h = r.hash();
          if (h === live.lastHash) continue;
          live.lastHash = h;
          blit(live.tex, r);
          live.image.setVisible(true);
          const lit = (live.state as { windowLit?: boolean }).windowLit;
          if (lit && !live.glow) {
            live.glow = ctx.lighting.addGlow({
              x: live.x,
              y: layout.groundY - 40,
              radius: 28,
              intensity: 0.5,
              flicker: !ctx.calm,
            });
          } else if (!lit && live.glow) {
            live.glow.destroy();
            live.glow = null;
          }
        }
        if (fading) {
          const k = Math.min(1, (t - fade.since) / fade.dur);
          alphaNow = fade.from + (fade.to - fade.from) * k;
          interiorImg?.setAlpha(alphaNow);
          veil?.setAlpha(alphaNow * 0.88);
          if (k >= 1) {
            fading = false;
            if (fade.to === 0) {
              interiorImg?.setVisible(false);
              veil?.setVisible(false); // an invisible veil must not eat pointer input
            }
          }
        }
        if (inside && dirty) blit(interiorTex, inside.def.paint(inside.state, 'interior', o));
      },
      destroy() {
        if (destroyed) return;
        if (inside) leave();
        destroyed = true;
        offEvent();
        scene.input.keyboard?.off('keydown-ESC', leave);
        releaseInput?.();
        interiorImg?.destroy();
        veil?.destroy();
        if (scene.textures.exists('scene-interior')) scene.textures.remove('scene-interior');
        for (const l of lives) {
          l.unregister();
          l.glow?.destroy();
          l.image.destroy();
          scene.textures.remove(l.key);
        }
      },
    };
  },
};

export default mod;
