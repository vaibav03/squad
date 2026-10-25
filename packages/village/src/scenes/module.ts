import type { VillageEvent } from '@squad/core';
import { createAssetLib, type AssetLib, type ManifestAsset } from './assets';
import {
  detectedInPage,
  fetchSkinManifests,
  layerPath,
  publishActiveSkins,
  skinMode,
  type LoadedSkin,
} from './skins/runtime';
import type { LayerName } from './skins/types';
import { DEFAULT_CTX, sanitizeEvent, step, type SceneCtx, type SceneDef } from './contract';
import { createRoomSession } from './roomSession';
import { publishRoomSession } from './rooms';
import { eventChapter } from './model/events';
import { Raster } from './pixel/raster';
import { PLACEMENTS, chapterSlotFor, type Placement } from './registry';
import {
  BOARD_H,
  BOARD_W,
  chapterNumber,
  paintBoard,
  publishMastery,
  requestMasteryPanel,
  sameMastery,
  type MasterySnapshot,
} from './mastery';
import { paintRoomArrows } from '../council/roomArrows';
import type { CouncilBoardStore } from '../council/store';
import { PLAN_TABLE_H, PLAN_TABLE_W, paintPlanTable, requestPlanPanel } from './plan';
import { SEAT_BOX, paintSeatRing, paintSeatTag, roomSeats, type RoomSeat } from './roomSeats';

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
  setInteractive(opts?: { useHandCursor?: boolean }): Img;
  setData(key: string, value: unknown): Img;
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
    on(k: 'leave', fn: (p: { slotId: string }) => void): () => void;
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
/** The slice of the inspector store the room seats use (the store itself lives in ../inspector). */
interface SeatStore {
  readonly selected: string | null;
  readonly room: { slot: string; who: string } | null;
  select(id: string | null, room?: { slot: string; who: string; initialTab?: 'chat' }): void;
  setSide(s: 'left' | 'right'): void;
  isThinking?(id: string, who?: string): boolean;
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
  const skins = await loadSkins(ctx);
  return createAssetLib(
    manifest,
    atlas,
    (p) => toRaster(scene.textures.get(KEY(p)).getSourceImage()),
    skins,
  );
}

/** Optional indoor skins from the local, gitignored art. Any problem means "no skin": the classic art stays, silently. */
async function loadSkins(ctx: HostCtx): Promise<Map<string, LoadedSkin>> {
  const out = new Map<string, LoadedSkin>();
  const mode = skinMode(globalThis.location?.search ?? '', detectedInPage());
  if (mode === 'off' || mode === 'none') return out;
  try {
    const manifests = await fetchSkinManifests(ctx.assets.url, async (u) => {
      const res = await fetch(u);
      const ct = res.headers.get('content-type') ?? '';
      return res.ok && !ct.includes('text/html') ? res.json() : undefined;
    });
    const { scene } = ctx;
    const jobs: Array<{ id: string; layer: LayerName; key: string; path: string }> = [];
    for (const m of manifests)
      for (const layer of ['bg', 'mid', 'fg'] as const) {
        const path = layerPath(m, layer);
        if (path) jobs.push({ id: m.id, layer, key: KEY(path), path });
      }
    await new Promise<void>((resolve) => {
      let queued = 0;
      for (const j of jobs) {
        if (scene.textures.exists(j.key)) continue;
        scene.load.image(j.key, ctx.assets.url(j.path));
        queued++;
      }
      if (queued === 0) return resolve();
      scene.load.once('complete', resolve);
      scene.load.start();
    });
    for (const m of manifests) {
      const layers: LoadedSkin['layers'] = {};
      for (const j of jobs.filter((x) => x.id === m.id))
        if (scene.textures.exists(j.key))
          layers[j.layer] = toRaster(scene.textures.get(j.key).getSourceImage());
      if (!layers.bg) continue;
      out.set(m.scene, {
        id: m.id,
        scene: m.scene,
        title: m.title,
        credit: m.credit,
        layout: m.layout,
        layers,
      });
    }
    publishActiveSkins(
      [...out.values()].map((k) => ({ scene: k.scene, id: k.id, title: k.title, credit: k.credit })),
    );
  } catch {
    out.clear();
  }
  return out;
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
    const session = createRoomSession(); // what was said in each room; the DOM reads it via @squad/village/rooms
    publishRoomSession(session);
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
    // clickable characters inside the room (Agent Inspector targets)
    let seats: RoomSeat[] = [];
    let seatKey = '';
    let zones: Img[] = [];
    let hoverSeat = -1;
    let kbSeat = -1;
    let seatsDirty = false;
    let arrowsOn = false; // arrows on screen: keep repainting the room
    let boardVersion = -1; // a new council message may start an arrow: repaint once to find out
    const store = (): SeatStore | undefined =>
      ctx.registry.get('inspector') as SeatStore | undefined;

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

    // The Mastery board: a walk-up notice board. Enter opens the in-world mastery panel (DOM, in the web host).
    const boardSlot = layout.slot('mastery-board');
    if (scene.textures.exists('scene-mastery-board')) scene.textures.remove('scene-mastery-board');
    const boardTex = scene.textures.createCanvas('scene-mastery-board', BOARD_W, BOARD_H);
    const boardImage = scene.add
      .image(boardSlot.x, layout.groundY + 1, 'scene-mastery-board')
      .setOrigin(0.5, 1)
      .setDepth(depth.buildings)
      .setVisible(false);
    const offBoard = ctx.interactables.register({
      id: 'enter-mastery-board',
      x: boardSlot.x,
      radius: 30,
      label: 'Open Mastery board',
      onActivate: () => requestMasteryPanel(),
    });
    const planSlot = layout.slot('plan-table');
    if (scene.textures.exists('scene-plan-table')) scene.textures.remove('scene-plan-table');
    const planTex = scene.textures.createCanvas('scene-plan-table', PLAN_TABLE_W, PLAN_TABLE_H);
    const planImage = scene.add
      .image(planSlot.x, layout.groundY + 1, 'scene-plan-table')
      .setOrigin(0.5, 1)
      .setDepth(depth.buildings)
      .setVisible(false);
    const offPlan = ctx.interactables.register({
      id: 'enter-plan-table',
      x: planSlot.x,
      radius: 30,
      label: 'Open Study plan',
      onActivate: () => requestPlanPanel(),
    });
    let planHash = '';
    let masterySnap: MasterySnapshot = { chapters: [] };
    let boardHash = '';
    function syncMastery(): void {
      const next: MasterySnapshot = {
        chapters: lives
          .filter((l) => l.p.chapter)
          .map((l) => {
            const st = l.state as { instance: string; title: string; glow: number; access: string };
            return {
              slot: l.p.slotId,
              instance: st.instance,
              title: st.title,
              box: st.access === 'open' ? st.glow * 5 : 0, // a quiet house has nothing to show yet
              n: chapterNumber(st.instance) ?? chapterNumber(l.p.slotId),
              open: st.access === 'open',
            };
          }),
      };
      if (sameMastery(masterySnap, next)) return;
      masterySnap = next;
      publishMastery(next);
    }
    syncMastery();

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
        .on('pointerdown', () => {
          // a click on empty space closes the inspector first; the room stays
          if (store()?.selected) return;
          leave();
        });
      interiorImg = scene.add
        .image(cx - INT_W / 2, cy - INT_H / 2, 'scene-interior')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(depth.lighting + 6)
        .setAlpha(0)
        .setVisible(false)
        // the room itself swallows clicks: only the dark veil around it walks you out
        .setInteractive()
        .on('pointerdown', () => undefined);
    }

    const agentOf = (live: Live): string => {
      if (live.p.agent) return live.p.agent;
      for (const [chapter, slotId] of chapterSlots)
        if (slotId === live.p.slotId) return `expert:${chapter}`;
      return 'expert:chapter';
    };
    const clearZones = (): void => {
      zones.forEach((z) => z.destroy());
      zones = [];
      seats = [];
      seatKey = '';
      hoverSeat = -1;
      kbSeat = -1;
    };
    function openSeat(i: number): void {
      const seat = seats[i];
      const st = store();
      if (!seat || !st || !inside) return;
      const cx = Math.round(scene.scale.width / 2);
      st.setSide(cx - INT_W / 2 + seat.x > scene.scale.width / 2 ? 'left' : 'right');
      st.select(seat.agent, { slot: inside.p.slotId, who: seat.who, initialTab: 'chat' });
    }
    /** Rebuild the hit zones when the cast of the room changes (council seats fill in as members speak). */
    function syncSeats(live: Live): void {
      const next = roomSeats(
        live.p.slotId,
        agentOf(live),
        live.state,
        assets?.skin?.(live.p.slotId)?.layout,
      );
      const key = next.map((n) => `${n.agent}|${n.who}|${n.x}|${n.y}`).join(';');
      if (key === seatKey) return;
      zones.forEach((z) => z.destroy());
      seatKey = key;
      seats = next;
      const cx = Math.round(scene.scale.width / 2);
      const cy = Math.round(scene.scale.height / 2);
      zones = next.map((seat, i) =>
        scene.add
          .rectangle(
            cx - INT_W / 2 + seat.x,
            cy - INT_H / 2 + seat.y - SEAT_BOX.h / 2 + 2,
            SEAT_BOX.w,
            SEAT_BOX.h,
            0xffffff,
            0.01,
          )
          .setScrollFactor(0)
          .setDepth(depth.lighting + 7)
          .setData('inspect', `${seat.agent}#${seat.who}`)
          .setInteractive({ useHandCursor: true })
          .on('pointerover', () => {
            hoverSeat = i;
            seatsDirty = true;
          })
          .on('pointerout', () => {
            if (hoverSeat === i) hoverSeat = -1;
            seatsDirty = true;
          })
          .on('pointerdown', () => openSeat(i)),
      );
      session.setSeats?.(
        next.map((n) => ({ slot: live.p.slotId, agent: n.agent, who: n.who, label: n.label })),
      );
      seatsDirty = true;
    }
    function paintRoom(live: Live, o: { t: number; calm: boolean; assets: AssetLib }): Raster {
      const r = live.def.paint(live.state, 'interior', o).clone();
      const st = store();
      seats.forEach((seat, i) => {
        const picked = !!st && st.selected === seat.agent && st.room?.who === seat.who;
        if (picked || i === kbSeat) paintSeatRing(r, seat);
        if (i === hoverSeat || i === kbSeat)
          paintSeatTag(r, seat, i === kbSeat, {
            on: !!st?.isThinking?.(seat.agent, seat.who),
            t: o.t,
            calm: o.calm,
          });
      });
      // message arrows between the seats (the board store is optional)
      arrowsOn = paintRoomArrows(
        r,
        ctx.registry.get('councilBoard') as CouncilBoardStore | undefined,
        seats,
        live.p.agent ?? '',
        o.calm,
      );
      return r;
    }
    // Keyboard in a room: Tab / arrows move between the characters, Enter opens the inspector on one.
    const onRoomKey = (e: KeyboardEvent): void => {
      if (!inside || e.metaKey || e.ctrlKey || e.altKey || seats.length === 0) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !t.closest?.('.sqv-stage')) return;
      const dir =
        e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)
          ? 1
          : e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)
            ? -1
            : 0;
      if (dir !== 0) {
        e.preventDefault();
        e.stopPropagation();
        kbSeat =
          kbSeat < 0
            ? dir === 1
              ? 0
              : seats.length - 1
            : (kbSeat + dir + seats.length) % seats.length;
        seatsDirty = true;
        ctx.bus.emit('announce', `${seats[kbSeat]!.label}. Press Enter to read the chat.`);
      } else if (e.key === 'Enter' && kbSeat >= 0) {
        e.preventDefault();
        e.stopPropagation();
        openSeat(kbSeat);
      }
    };
    document.addEventListener('keydown', onRoomKey, true);

    function enter(live: Live): void {
      if (inside || !assets) return;
      ensureInterior();
      inside = live;
      live.state = live.def.onEnter?.(live.state, now) ?? live.state;
      releaseInput = ctx.player.lockInput();
      ctx.registry.set('playerX', ctx.player.x);
      ctx.player.sprite.setVisible(false);
      session.enter(live.p.slotId);
      syncSeats(live);
      ctx.bus.emit('enter', { slotId: live.p.slotId });
      fade = { from: alphaNow, to: 1, since: now, dur: ctx.calm ? 120 : 200 };
      fading = true;
      if (assets) blit(interiorTex, paintRoom(live, { t: now, calm: ctx.calm, assets }));
      // a council room shares the screen with the docked council panel: slide the room clear of it (panel on the
      // right on wide screens, a bottom sheet on narrow ones), so the table and the seats stay in view
      const wide = typeof window !== 'undefined' && window.innerWidth >= 1000;
      const councilRoom = live.p.slotId === 'council-hall' || live.p.slotId === 'round-table';
      interiorImg?.setPosition(
        Math.round(scene.scale.width * (councilRoom && wide ? 0.31 : 0.5)) - INT_W / 2,
        Math.round(scene.scale.height * (councilRoom && !wide ? 0.26 : 0.5)) - INT_H / 2,
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
      if (store()?.room?.slot) store()?.select(null); // the popup belongs to the room
      clearZones();
      session.leave();
      ctx.bus.emit('leave', { slotId: live.p.slotId });
    }
    scene.input.keyboard?.on('keydown-ESC', leave);
    // The world boots with Phaser's keyboard plugin off (the stage element owns keys), so Esc reaches us as a bus
    // 'leave' from the input module. leave() is idempotent, so our own emit below does not loop.
    const offLeave = ctx.bus.on('leave', () => leave());

    const offEvent = ctx.bus.on('villageEvent', (e: VillageEvent) => {
      const c = sceneCtx();
      const chapter = eventChapter(e);
      if (chapter && !chapterSlots.has(chapter)) {
        const slotId = chapterSlotFor(chapter, new Set(chapterSlots.values()));
        const live = lives.find((l) => l.p.slotId === slotId);
        if (slotId && live) {
          chapterSlots.set(chapter, slotId);
          ctx.registry.set('chapterSlots', Object.fromEntries(chapterSlots)); // read by the mesh view and the camera director
          live.state = live.def.init({ instance: chapter, title: chapterTitle(chapter) });
        }
      }
      const clean = sanitizeEvent(e, c); // the transcript never holds another student's `correct`
      for (const live of lives) {
        if (live.def.handles(clean, live.state, c)) session.record(live.p.slotId, clean, now);
        const before = live.state;
        live.state = step(live.def, live.state, e, c, now);
        if (live.state !== before && e.t === 'council.verdict') {
          ctx.bus.emit('announce', `Council verdict: ${e.text ?? ''}`.trim());
        }
        if (live.state !== before) live.label = live.def.describe(live.state);
      }
      syncMastery();
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
        if (dirty) {
          const br = paintBoard(masterySnap.chapters, t, ctx.calm);
          const bh = br.hash();
          if (bh !== boardHash) {
            boardHash = bh;
            blit(boardTex, br);
            boardImage.setVisible(true);
          }
        }
        if (dirty) {
          const pr = paintPlanTable(t, ctx.calm);
          const ph = pr.hash();
          if (ph !== planHash) {
            planHash = ph;
            blit(planTex, pr);
            planImage.setVisible(true);
          }
        }
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
        if (inside) syncSeats(inside);
        const bv =
          (ctx.registry.get('councilBoard') as CouncilBoardStore | undefined)?.version ?? -1;
        if (bv !== boardVersion) {
          boardVersion = bv;
          arrowsOn = true;
        }
        if (inside && (dirty || seatsDirty || arrowsOn)) {
          seatsDirty = false;
          blit(interiorTex, paintRoom(inside, o));
        }
      },
      destroy() {
        if (destroyed) return;
        if (inside) leave();
        destroyed = true;
        offEvent();
        offLeave();
        scene.input.keyboard?.off('keydown-ESC', leave);
        offBoard();
        offPlan();
        planImage.destroy();
        if (scene.textures.exists('scene-plan-table')) scene.textures.remove('scene-plan-table');
        boardImage.destroy();
        if (scene.textures.exists('scene-mastery-board'))
          scene.textures.remove('scene-mastery-board');
        document.removeEventListener('keydown', onRoomKey, true);
        clearZones();
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
