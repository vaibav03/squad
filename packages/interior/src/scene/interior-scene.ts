import Phaser from 'phaser';
import type { VillageEvent, VillageSource } from '@squad/core';
import type { CameraMode, InteriorWorldDebug, MountOptions, OverlayEvent } from '../api';
import { DIRS, pickSkin, joinUrl } from '../assets/manifest';
import type { Manifest } from '../assets/manifest';
import { direct } from '../agents/director';
import type { Command, Goal } from '../agents/director';
import { nearestInteractable, overlayFor } from '../agents/interact';
import { resolveGoal, occupiedKey } from '../nav/goals';
import { Pathfinder, tileCenter, tileOf } from '../nav/pathfinder';
import type { Vec } from '../nav/pathfinder';
import { createOverlayBridge } from '../shared/overlay-bridge';
import type { OverlayBridge } from '../shared/overlay-bridge';
import { CollisionGrid, boxBlocked, moveAndSlide } from '../tilemap/collision';
import type { InteriorMap, PropsDef, DoorDef, TileLayerName } from '../tilemap/types';
import { TILE } from '../tilemap/types';
import { buildingFrame, lerpScroll, roomFrame, roomScroll } from '../world/camera-math';
import { DUR, easeInOut } from '../world/motion';
import { createRng } from '../world/rng';
import { RoomRegistry } from '../world/rooms';
import { DEPTH, SORT_BIAS, ysortDepth } from '../world/ysort';
import { NpcActor, PlayerActor, FEET_BOX, WALK_SPEED } from './actors';
import type { Hud } from './hud';
import { ACTION_KEYS, KeyState, MOVE_KEYS } from './input';
import { PALETTE, SPRITES } from './pixel-art';

export interface SceneInit {
  opts: MountOptions;
  assetBase: string;
  manifest: Manifest;
  map: InteriorMap;
  propsDef: PropsDef;
  stage: HTMLElement;
  hud: Hud;
  calm: { value: boolean };
  log: (m: string, e?: unknown) => void;
  onReady: () => void;
  onFail: (e: unknown) => void;
}

const TILES_KEY = 'interior.tiles';
const PROPS_KEY = 'interior.props';

export class InteriorScene extends Phaser.Scene {
  private grid!: CollisionGrid;
  private nav!: Pathfinder;
  private rooms!: RoomRegistry;
  private player!: PlayerActor;
  private npcs = new Map<string, NpcActor>();
  private doorSprites = new Map<
    string,
    { def: DoorDef; sprite: Phaser.GameObjects.Image; state: string }
  >();
  private keys = new KeyState();
  private bridge!: OverlayBridge;
  private unsub: (() => void) | undefined;
  private rng = createRng(1);
  private inputLocks = 0;
  private cameraMode: CameraMode = 'room';
  private currentRoom: string | undefined;
  private camFrom: Vec = { x: 0, y: 0 };
  private camT = 1;
  private lastLockedMsg = -1e9;
  private tapMarker: Phaser.GameObjects.Image | undefined;
  private tapTween: Phaser.Tweens.Tween | undefined;
  private actionQueued = false;
  private pendingActivate: string | undefined;
  private readonly overlays: OverlayEvent[] = [];
  private readonly cleanup: (() => void)[] = [];
  private spawnIndex = 0;
  private building: { x: number; y: number; w: number; h: number } | undefined;

  constructor(private readonly init0: SceneInit) {
    super('interior');
  }

  /* ------------------------------------------------------------------ preload */
  preload(): void {
    const { manifest, assetBase } = this.init0;
    const url = (p: string) => joinUrl(assetBase, p);
    this.load.image(TILES_KEY, url(manifest.tileset.image));
    this.load.image(PROPS_KEY, url(manifest.props.image));
    for (const c of manifest.characters.cast) {
      const f = c.frame ?? manifest.characters.frame;
      this.load.spritesheet(`char.${c.id}`, url(c.image), { frameWidth: f.w, frameHeight: f.h });
    }
    this.load.on('loaderror', (f: Phaser.Loader.File) => {
      this.init0.log(`asset failed: ${f.key}`);
      if (
        f.key === TILES_KEY ||
        f.key === PROPS_KEY ||
        f.key === `char.${manifest.characters.player}`
      )
        this.init0.onFail(new Error(`required asset failed to load: ${f.key}`));
    });
  }

  /* ------------------------------------------------------------------- create */
  create(): void {
    try {
      this.build();
    } catch (e) {
      this.init0.onFail(e);
    }
  }

  private build(): void {
    const { map, propsDef, manifest, opts } = this.init0;
    this.rng = createRng(opts.seed ?? 1);
    this.rooms = new RoomRegistry(map);
    this.grid = CollisionGrid.fromMap(map, propsDef);
    this.nav = new Pathfinder(this.grid);
    this.cameraMode = opts.camera ?? 'room';

    this.makeTextures();
    this.makeAnims();
    this.buildTileLayers();
    this.buildProps();
    this.buildDoors();

    const spawn = map.spawns.find((s) => s.name === 'player') ?? map.spawns[0];
    const start = spawn ? tileCenter(tileOf(spawn.x, spawn.y)) : { x: map.pxW / 2, y: map.pxH / 2 };
    this.player = new PlayerActor(this, manifest, start.x, start.y + TILE / 2 - 2);
    this.currentRoom = this.rooms.roomAt(this.player.x, this.player.y - 1)?.id ?? map.defaultRoom;
    this.snapCameraNow();

    this.bridge = createOverlayBridge({
      onOverlay: (e) => {
        this.overlays.push(e);
        opts.onOverlay?.(e);
      },
      pauseInput: () => this.lockInput(),
      resumeInput: () => this.unlockInput(),
      focusCanvas: () => this.init0.stage.focus({ preventScroll: true }),
    });

    this.bindInput();
    this.unsub = opts.source.subscribe((e) => this.onEvent(e));
    this.refreshRoomHud(true);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointer, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    this.init0.onReady();
  }

  private makeTextures(): void {
    const t = this.textures;
    if (!t.exists('interior.shadow')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x070f1f, 0.34);
      g.fillRect(2, 0, 8, 1);
      g.fillRect(0, 1, 12, 2);
      g.fillRect(2, 3, 8, 1);
      g.generateTexture('interior.shadow', 12, 4);
      g.destroy();
      t.get('interior.shadow').setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    for (const [name, rows] of Object.entries(SPRITES)) {
      const key = `interior.${name}`;
      if (t.exists(key)) continue;
      t.generate(key, {
        data: rows,
        pixelWidth: 1,
        pixelHeight: 1,
        palette: { ...PALETTE, '.': '' } as never,
      });
    }
    const props = t.get(PROPS_KEY);
    for (const d of this.init0.propsDef.values())
      if (!props.has(d.name)) props.add(d.name, 0, d.x, d.y, d.w, d.h);
  }

  private makeAnims(): void {
    const { manifest } = this.init0;
    for (const c of manifest.characters.cast)
      for (const d of DIRS)
        for (const kind of ['walk', 'idle'] as const) {
          const frames = manifest.characters.anims[`${kind}-${d}`];
          if (!frames) continue;
          const key = `${c.id}:${kind}-${d}`;
          if (this.anims.exists(key)) continue;
          this.anims.create({
            key,
            frames: frames.map((frame) => ({ key: `char.${c.id}`, frame })),
            frameRate: manifest.characters.fps,
            repeat: -1,
          });
        }
  }

  private buildTileLayers(): void {
    const { map } = this.init0;
    const depth: Record<TileLayerName, number> = {
      ground: DEPTH.ground,
      wall: DEPTH.wall,
      furniture: DEPTH.furniture,
      overhead: DEPTH.overhead,
    };
    const fg = map.tileset.firstgid;
    for (const name of ['ground', 'wall', 'furniture', 'overhead'] as const) {
      const gids = map.layers[name];
      if (!gids.some((g) => g)) continue;
      const data: number[][] = [];
      for (let y = 0; y < map.height; y++) {
        const row: number[] = [];
        for (let x = 0; x < map.width; x++) {
          const g = gids[y * map.width + x]!;
          row.push(g ? g - fg : -1);
        }
        data.push(row);
      }
      const tm = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
      const ts = tm.addTilesetImage(`tiles-${name}`, TILES_KEY, TILE, TILE, 0, 0, 0);
      const layer = ts && tm.createLayer(0, ts, 0, 0);
      layer?.setDepth(depth[name]);
    }
  }

  private buildProps(): void {
    for (const p of this.init0.map.props) {
      if (!this.textures.get(PROPS_KEY).has(p.name)) {
        this.init0.log(`unknown prop "${p.name}"`);
        continue;
      }
      this.add
        .image(p.x, p.y, PROPS_KEY, p.name)
        .setOrigin(0, 1)
        .setFlipX(p.flip)
        .setDepth(ysortDepth(p.y, SORT_BIAS.prop));
    }
  }

  private buildDoors(): void {
    for (const d of this.init0.map.doors) {
      const state = this.rooms.isLocked(d.id) ? 'locked' : 'closed';
      const sprite = this.add
        .image(d.spriteX, d.spriteY, PROPS_KEY, `${d.prop}.${state}`)
        .setOrigin(0, 1)
        .setDepth(DEPTH.doors);
      this.doorSprites.set(d.id, { def: d, sprite, state });
    }
  }

  /* -------------------------------------------------------------------- input */
  private bindInput(): void {
    const stage = this.init0.stage;
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never swallow browser shortcuts
      // Keys pressed on the HUD prompt button are handled by its own click, not twice.
      if (e.target instanceof HTMLButtonElement && ACTION_KEYS.has(e.code)) return;
      if (MOVE_KEYS.has(e.code)) {
        this.keys.press(e.code);
        e.preventDefault();
      } else if (ACTION_KEYS.has(e.code) && !e.repeat) {
        this.actionQueued = true;
        if (e.code === 'Space') e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => this.keys.release(e.code);
    const blur = () => this.keys.clear();
    stage.addEventListener('keydown', down);
    stage.addEventListener('keyup', up);
    stage.addEventListener('blur', blur);
    this.cleanup.push(() => {
      stage.removeEventListener('keydown', down);
      stage.removeEventListener('keyup', up);
      stage.removeEventListener('blur', blur);
    });
  }

  private lockInput(): void {
    this.inputLocks++;
    this.keys.clear();
    this.player.followPath([]);
  }
  private unlockInput(): void {
    this.inputLocks = Math.max(0, this.inputLocks - 1);
  }
  private get locked(): boolean {
    return this.inputLocks > 0;
  }

  private onPointer(p: Phaser.Input.Pointer): void {
    if (this.locked) return;
    this.init0.stage.focus({ preventScroll: true });
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    // NPC under the pointer: open its details.
    for (const n of this.npcs.values()) {
      if (Math.abs(n.x - w.x) <= 8 && w.y <= n.y + 2 && w.y >= n.y - 16) {
        this.bridge.request({ type: 'focusAgent', agent: n.id });
        return;
      }
    }
    // Interactable under (or near) the pointer: walk next to it, then activate.
    const near = this.init0.map.interactables
      .map((i) => ({ i, d: Math.hypot(i.x - w.x, i.y - w.y) }))
      .filter((c) => c.d <= 14)
      .sort((a, b) => a.d - b.d)[0];
    const dest = this.nav.nearestWalkable(tileOf(near ? near.i.x : w.x, near ? near.i.y : w.y));
    if (!dest) return;
    if (this.walkToTile(dest)) {
      this.pendingActivate = near?.i.id;
      this.showTap(tileCenter(dest));
    }
  }

  private walkToTile(dest: { x: number; y: number }): boolean {
    this.nav.refresh();
    const from = tileOf(this.player.x, this.player.y - 1);
    const path = this.nav.find(from, dest);
    if (!path) return false;
    this.player.followPath(this.pathToPoints(path, this.player));
    this.pendingActivate = undefined;
    return true;
  }

  /** Tile path -> feet points at tile centres (feet sit 2px above the centre line for chibi proportions). */
  private pathToPoints(path: { x: number; y: number }[], who: { x: number; y: number }): Vec[] {
    const pts = path.map((t) => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 + 6 }));
    // drop the first point if we are already (nearly) there
    if (pts[0] && Math.hypot(pts[0].x - who.x, pts[0].y - who.y) < 0.5) pts.shift();
    return pts;
  }

  private showTap(at: Vec): void {
    this.tapTween?.stop();
    this.tapMarker?.destroy();
    if (!this.textures.exists('interior.tap')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.lineStyle(1, 0xffc857, 1);
      g.strokeRect(0.5, 0.5, 11, 5);
      g.generateTexture('interior.tap', 12, 6);
      g.destroy();
    }
    this.tapMarker = this.add
      .image(Math.round(at.x), Math.round(at.y + 6), 'interior.tap')
      .setDepth(DEPTH.fx)
      .setAlpha(0.9);
    this.tapTween = this.tweens.add({
      targets: this.tapMarker,
      alpha: 0,
      duration: this.init0.calm.value ? 120 : 600,
      delay: 200,
      ease: (t: number) => 1 - Math.pow(1 - t, 3),
    });
  }

  /* --------------------------------------------------------------- directives */
  private onEvent(e: VillageEvent): void {
    for (const c of direct(e)) this.run(c);
  }

  private run(c: Command): void {
    switch (c.type) {
      case 'ensure':
        this.ensureNpc(c.agent);
        break;
      case 'goto':
        this.sendTo(c.agent, c.goal);
        break;
      case 'lock':
        this.setDoorLocked(c.door, c.locked);
        break;
      case 'marker':
        this.ensureNpc(c.agent).setMarker(c.marker);
        break;
      case 'gather':
        for (const id of [...this.npcs.keys()]) this.sendTo(id, { kind: 'room', room: c.room });
        break;
      case 'announce':
        this.init0.hud.announce(c.text);
        break;
    }
  }

  ensureNpc(id: string): NpcActor {
    const have = this.npcs.get(id);
    if (have) return have;
    const { map, manifest } = this.init0;
    const spawns = map.spawns.filter((s) => s.name.startsWith('npc'));
    const s = spawns.length ? spawns[this.spawnIndex++ % spawns.length]! : map.spawns[0];
    const c = s ? tileCenter(tileOf(s.x, s.y)) : { x: map.pxW / 2, y: map.pxH / 2 };
    const npc = new NpcActor(this, manifest, pickSkin(manifest, id), id, c.x, c.y + 6);
    npc.wanderAt = this.time.now + 2000 + this.rng() * 4000;
    this.npcs.set(id, npc);
    return npc;
  }

  private occupiedGoals(except?: string): Set<string> {
    const s = new Set<string>();
    for (const n of this.npcs.values()) {
      if (n.id === except) continue;
      if (n.goalKey) s.add(n.goalKey);
    }
    return s;
  }

  sendTo(id: string, goal: Goal, wander = false): boolean {
    const npc = this.ensureNpc(id);
    const dest = resolveGoal(goal, this.rooms, this.occupiedGoals(id), this.rng);
    if (!dest) return false;
    this.nav.refresh();
    const path = this.nav.find(tileOf(npc.x, npc.y - 1), tileOf(dest.x, dest.y));
    if (!path) {
      npc.goalKey = undefined; // never keep reserving a seat we cannot reach
      return false;
    }
    npc.wander = wander || (goal.kind === 'room' && goal.room === 'commons');
    npc.followPath(this.pathToPoints(path, npc));
    npc.goalKey = occupiedKey(dest);
    npc.goal = { goal, wander };
    return true;
  }

  setDoorLocked(id: string, locked: boolean): void {
    if (!this.rooms.setLocked(id, locked)) return;
    this.grid.setDoorLocked(id, locked);
    this.nav.refresh();
    if (locked) {
      this.nudgeOutOfDoor(this.player, id);
      // Replan everyone who is walking: a locked door must never be walked through.
      for (const n of this.npcs.values()) {
        if (!n.busy || !n.goal) continue;
        const { goal, wander } = n.goal;
        n.followPath([]);
        if (!this.sendTo(n.id, goal, wander)) n.goal = undefined;
      }
    }
    this.updateDoorSprites(true);
    this.init0.hud.announce(
      `${id.replace(/^door-/, '').replace(/-/g, ' to ')} door ${locked ? 'locked' : 'unlocked'}.`,
    );
  }

  /** If an actor stands inside a door that just locked, put it on the nearest walkable tile. */
  private nudgeOutOfDoor(a: { x: number; y: number; sync(): void }, doorId: string): void {
    const d = this.rooms.door(doorId);
    if (!d) return;
    const r = d.rect;
    const inside =
      a.x >= r.x - 5 && a.x < r.x + r.w + 5 && a.y - 3 >= r.y - 3 && a.y - 3 < r.y + r.h + 3;
    if (!inside || !boxBlocked(this.grid, a.x, a.y, FEET_BOX)) return;
    const t = this.nav.nearestWalkable(tileOf(a.x, a.y - 1), 4);
    if (!t) return;
    a.x = t.x * TILE + TILE / 2;
    a.y = t.y * TILE + TILE / 2 + 6;
    a.sync();
  }

  private updateDoorSprites(force = false): void {
    const actors: { x: number; y: number }[] = [this.player, ...this.npcs.values()];
    for (const rec of this.doorSprites.values()) {
      const d = rec.def;
      let state = 'closed';
      if (this.rooms.isLocked(d.id)) state = 'locked';
      else {
        const cx = d.rect.x + d.rect.w / 2;
        const cy = d.rect.y + d.rect.h / 2;
        const reach = TILE * 1.75 + Math.max(d.rect.w, d.rect.h) / 2;
        if (actors.some((a) => Math.hypot(a.x - cx, a.y - 4 - cy) < reach)) state = 'open';
      }
      if (force || state !== rec.state) {
        rec.state = state;
        const frame = `${d.prop}.${state}`;
        if (this.textures.get(PROPS_KEY).has(frame)) rec.sprite.setFrame(frame);
      }
    }
  }

  /* ------------------------------------------------------------------- camera */
  private viewSize() {
    return { w: this.scale.width, h: this.scale.height };
  }

  private cameraTarget(): Vec {
    const { map } = this.init0;
    const view = this.viewSize();
    const mapPx = { w: map.pxW, h: map.pxH };
    const focus = { x: this.player.x, y: this.player.y - 8 };
    // Never show the void margin of the map: clamp to the built area.
    const building = (this.building ??= buildingFrame(map.rooms, mapPx));
    const room = this.currentRoom ? this.rooms.room(this.currentRoom) : undefined;
    if (this.cameraMode === 'follow' || !room) return roomScroll(focus, view, building);
    return roomScroll(focus, view, roomFrame(room.bounds, mapPx), building);
  }

  private snapCameraNow(): void {
    const t = this.cameraTarget();
    this.cameras.main.setScroll(t.x, t.y);
    this.camFrom = t;
    this.camT = 1;
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    const target = this.cameraTarget();
    let s = target;
    if (this.camT < 1) {
      this.camT = Math.min(1, this.camT + (dt * 1000) / DUR.cameraPan);
      s = lerpScroll(this.camFrom, target, easeInOut(this.camT));
    }
    cam.setScroll(s.x, s.y);
  }

  private onRoomChanged(room: string): void {
    this.currentRoom = room;
    if (this.cameraMode === 'room' && !this.init0.calm.value) {
      const cam = this.cameras.main;
      this.camFrom = { x: cam.scrollX, y: cam.scrollY };
      this.camT = 0;
    } else if (this.cameraMode === 'room') {
      this.camT = 1; // Calm: jump cut
    }
    this.refreshRoomHud();
  }

  private refreshRoomHud(first = false): void {
    const r = this.currentRoom ? this.rooms.room(this.currentRoom) : undefined;
    if (!r) return;
    this.init0.hud.setRoom(r.label);
    if (!first) this.init0.hud.announce(`You are in the ${r.label}.`);
  }

  /* ------------------------------------------------------------------- update */
  override update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.updatePlayer(dt);
    this.updateNpcs(dt);
    this.updateRoom();
    this.updateCamera(dt);
    this.updateDoorSprites();
    this.updatePrompt();
    if (this.actionQueued) {
      this.actionQueued = false;
      if (!this.locked) this.activateNearest();
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const v = this.locked ? { x: 0, y: 0 } : this.keys.vector();
    if (v.x || v.y) {
      p.follower = undefined;
      this.pendingActivate = undefined;
      const r = moveAndSlide(this.grid, p, v.x * WALK_SPEED * dt, v.y * WALK_SPEED * dt, FEET_BOX);
      p.x = r.x;
      p.y = r.y;
      p.dir = this.keys.facing(p.dir);
      p.moving = true;
      p.play(true);
      p.sync();
      if (r.hitX || r.hitY) this.maybeLockedMessage(v);
      return;
    }
    if (p.stepPath(dt)) return;
    if (this.pendingActivate && !p.busy) {
      const id = this.pendingActivate;
      this.pendingActivate = undefined;
      const def = this.init0.map.interactables.find((i) => i.id === id);
      if (def) this.activate(def.id);
    }
  }

  private maybeLockedMessage(v: Vec): void {
    const now = this.time.now;
    if (now - this.lastLockedMsg < 2500) return;
    const px = this.player.x + Math.sign(v.x) * 6;
    const py = this.player.y - 3 + Math.sign(v.y) * 6;
    for (const d of this.init0.map.doors) {
      if (!this.rooms.isLocked(d.id)) continue;
      const r = d.rect;
      if (px >= r.x - 2 && px < r.x + r.w + 2 && py >= r.y - 2 && py < r.y + r.h + 2) {
        this.lastLockedMsg = now;
        const other = this.rooms.room(d.b)?.label ?? 'room';
        this.init0.hud.announce(`The ${other} is locked.`);
        return;
      }
    }
  }

  private updateNpcs(dt: number): void {
    const calm = this.init0.calm.value;
    for (const n of this.npcs.values()) {
      const walking = n.stepPath(dt);
      if (walking || n.busy || !n.wander || calm) continue;
      if (this.time.now >= n.wanderAt) {
        const room = this.rooms.roomAt(n.x, n.y - 1)?.id ?? 'commons';
        this.sendTo(n.id, { kind: 'room', room }, true);
        n.wanderAt = this.time.now + 3500 + this.rng() * 6000;
      }
    }
  }

  private updateRoom(): void {
    const r = this.rooms.roomAt(this.player.x, this.player.y - 1);
    if (r && r.id !== this.currentRoom) this.onRoomChanged(r.id);
  }

  private updatePrompt(): void {
    const near = this.locked
      ? undefined
      : nearestInteractable(this.init0.map.interactables, this.player.x, this.player.y - 6);
    this.init0.hud.setPrompt(near?.def.label, near ? () => this.activate(near.def.id) : undefined);
  }

  private activateNearest(): void {
    const near = nearestInteractable(
      this.init0.map.interactables,
      this.player.x,
      this.player.y - 6,
    );
    if (near) this.activate(near.def.id);
  }

  private activate(id: string): void {
    const def = this.init0.map.interactables.find((i) => i.id === id);
    if (!def) return;
    const ev = overlayFor(def);
    if (ev) this.bridge.request(ev);
    else this.init0.hud.announce(`${def.label}. Nothing to open yet.`);
  }

  overlayClosed(): void {
    this.bridge.closed();
  }

  setCameraMode(m: CameraMode): void {
    if (m === this.cameraMode) return;
    const cam = this.cameras.main;
    this.camFrom = { x: cam.scrollX, y: cam.scrollY };
    this.cameraMode = m;
    this.camT = this.init0.calm.value ? 1 : 0;
  }

  /* ----------------------------------------------------------------- teardown */
  private tornDown = false;
  private teardown(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    this.unsub?.();
    this.bridge?.dispose();
    this.init0.hud.destroy();
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
  }

  /* -------------------------------------------------------------------- debug */
  debugApi(): InteriorWorldDebug {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      player: {
        get x() {
          return self.player.x;
        },
        get y() {
          return self.player.y;
        },
        get room() {
          return self.rooms.roomAt(self.player.x, self.player.y - 1)?.id;
        },
        walkTo: (x, y) => {
          const dest = self.nav.nearestWalkable(tileOf(x, y));
          return !!dest && self.walkToTile(dest);
        },
      },
      get npcs() {
        return [...self.npcs.values()].map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          room: self.rooms.roomAt(n.x, n.y - 1)?.id,
          moving: n.moving,
        }));
      },
      rooms: this.rooms.rooms.map((r) => r.id),
      get doors() {
        return self.init0.map.doors.map((d) => ({ id: d.id, locked: self.rooms.isLocked(d.id) }));
      },
      setDoorLocked: (id, l) => this.setDoorLocked(id, l),
      teleport: (x, y) => {
        this.player.x = x;
        this.player.y = y;
        this.player.follower = undefined;
        this.player.sync();
        this.updateRoom();
        this.snapCameraNow();
      },
      teleportToRoom: (id) => {
        const r = this.rooms.room(id);
        if (!r) return false;
        const wp = this.rooms.waypointsIn(id)[0];
        const c = wp
          ? tileCenter(tileOf(wp.x, wp.y))
          : { x: r.bounds.x + r.bounds.w / 2, y: r.bounds.y + r.bounds.h / 2 };
        this.player.x = c.x;
        this.player.y = c.y + 6;
        this.player.follower = undefined;
        this.player.sync();
        this.updateRoom();
        this.snapCameraNow();
        return true;
      },
      sendNpc: (id, target) =>
        this.sendTo(
          id,
          this.rooms.room(target)
            ? { kind: 'room', room: target }
            : { kind: 'waypoint', name: target },
        ),
      spawnNpc: (id) => void this.ensureNpc(id),
      setCamera: (m) => this.setCameraMode(m),
      get overlays() {
        return self.overlays;
      },
    };
  }
}

export type { VillageSource };
