import Phaser from 'phaser';
import { VillageEventSchema, type VillageEvent, type VillageSource } from '@squad/core';
import {
  ASSETS as CHARACTER_ASSETS,
  createInput,
  createPlayer,
  type InputImpl,
  type PlayerImpl,
} from '../character';
import { createCamera, type CameraImpl } from '../camera';
import { createHud } from '../hud';
import { createInspectorStore, type InspectorStore } from '../inspector/store';
import {
  ASSETS as PARALLAX_ASSETS,
  createLighting,
  createParallax,
  createWorldTime,
  type LightingImpl,
  type WorldTimeImpl,
} from '../parallax';
import { createAssetApi, queueSpecs } from '../boot/assets';
import {
  DEPTH,
  type AdapterModule,
  type AssetSpec,
  type CameraMode,
  type MountOptions,
  type ModuleInstance,
  type OverlayEvent,
  type SceneCommand,
  type SceneModule,
  type VillageContext,
} from '../world/api';
import { createLayout } from '../world/layout';
import { ASSETS as DRESSING_ASSETS, createDressing } from '../world/dressing';
import { motionStub } from '../world/motion-stub';
import { createAgentRegistry, createBus, createInteractables } from './bus';

export interface WorldSceneInit {
  opts: MountOptions;
  assetBase: string;
  manifestSpecs: AssetSpec[];
  modules: SceneModule[];
  adapter?: AdapterModule;
  stage: HTMLElement; // positioned box exactly over the canvas; HUD lives here
  calm: { value: boolean };
  log: (m: string, e?: unknown) => void;
  onReady: () => void;
}

const PALETTE = { ink: 0x070f1f, glow: 0xffc857, moon: 0xfff2c4, line: 0x2f5f84 };

export class WorldScene extends Phaser.Scene {
  ctx!: VillageContext;
  private parts: { update(t: number, dt: number): void; destroy(): void }[] = [];
  private instances: Array<{ mod: SceneModule; inst: ModuleInstance }> = [];
  private unsubs: Array<() => void> = [];
  private time_!: WorldTimeImpl;
  private ready = false;
  private frames = 0;

  constructor(private init_: WorldSceneInit) {
    super('world');
  }

  preload() {
    const { init_: I } = this;
    const bar = this.add.graphics();
    this.load.on('progress', (v: number) => {
      bar.clear();
      const w = Math.min(120, this.scale.width - 40),
        x = Math.round((this.scale.width - w) / 2),
        y = Math.round(this.scale.height / 2);
      bar.fillStyle(PALETTE.line, 1).fillRect(x, y, w, 4);
      bar.fillStyle(PALETTE.glow, 1).fillRect(x, y, Math.round(w * v), 4);
    });
    this.load.on('loaderror', (f: Phaser.Loader.File) =>
      I.log(`asset failed: ${f.key} (${f.url as string})`),
    );
    this.load.once('complete', () => bar.destroy());
    queueSpecs(this.load, I.assetBase, [
      ...PARALLAX_ASSETS,
      ...CHARACTER_ASSETS,
      ...DRESSING_ASSETS,
      ...I.manifestSpecs,
    ]);
  }

  create() {
    const I = this.init_;
    const bus = createBus();
    const agents = createAgentRegistry(bus);
    const interactables = createInteractables();
    const inspector = I.opts.inspector ?? createInspectorStore({ me: I.opts.me });
    this.registry.set('inspector', inspector);
    if (I.opts.councilBoard) this.registry.set('councilBoard', I.opts.councilBoard);
    const layout = createLayout();
    const calm = I.calm;
    const getCalm = () => calm.value;
    const motion = motionStub;
    const lock = { unlock: undefined as undefined | (() => void) };

    this.cameras.main.setBackgroundColor(PALETTE.ink);
    const time = (this.time_ = createWorldTime({ mode: I.opts.time ?? 'night', calm: getCalm }));
    const lighting: LightingImpl = createLighting(this, time, getCalm);
    const assets = createAssetApi(() => this.textures, I.assetBase);
    const parallax = createParallax(this, { layout, time, assets, calm: getCalm });
    const dressing = createDressing(this, { layout, time, lighting, has: assets.has });
    const player: PlayerImpl = createPlayer(this, {
      layout,
      time,
      motion,
      calm: getCalm,
      registry: this.registry,
      bus,
    });
    const camera: CameraImpl = createCamera(this, {
      layout,
      player,
      bus,
      motion,
      calm: getCalm,
      registry: this.registry,
    });
    const stage = I.stage;
    const input: InputImpl = createInput(this, {
      player,
      camera: this.cameras.main,
      layout,
      interactables,
      bus,
      focusEl: stage,
    });

    const ctx: VillageContext = {
      game: this.game,
      scene: this,
      layout,
      depth: DEPTH,
      time,
      lighting,
      agents,
      player,
      camera,
      assets,
      bus,
      interactables,
      registry: this.registry,
      me: I.opts.me,
      get calm() {
        return calm.value;
      },
      motion,
      log: I.log,
    };
    this.ctx = ctx;

    // overlay bridge: forward + lock input until the host reports the overlay closed
    this.unsubs.push(
      bus.on('overlay', (o: OverlayEvent) => {
        if (o.type === 'closeOverlay') {
          lock.unlock?.();
          lock.unlock = undefined;
        } else if (!lock.unlock) lock.unlock = player.lockInput();
        try {
          I.opts.onOverlay?.(o);
        } catch (e) {
          I.log('onOverlay threw', e);
        }
      }),
    );
    this.unsubs.push(
      bus.on('overlayClosed', () => {
        lock.unlock?.();
        lock.unlock = undefined;
      }),
    );
    const announce = stage.ownerDocument.createElement('div');
    announce.setAttribute('aria-live', 'polite');
    announce.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    stage.appendChild(announce);
    this.unsubs.push(
      bus.on('announce', (t) => {
        announce.textContent = '';
        setTimeout(() => (announce.textContent = t), 30);
      }),
      () => announce.remove(),
    );

    const hud =
      I.opts.hud === false
        ? undefined
        : createHud({
            parent: stage,
            bus,
            agents,
            camera,
            player,
            layout,
            time,
            interactables,
            calm: {
              get: getCalm,
              set: (v) => {
                calm.value = v;
                bus.emit('calm', v);
              },
            },
            assetUrl: assets.url,
            ...(I.opts.me ? { me: I.opts.me } : {}),
            inspector,
            focusAgent: (id) => {
              // Every agent meets in the Agent Hall: a chip walks there and pre-selects that agent.
              const openHall = this.registry.get('openHall') as ((agent: string) => void) | undefined;
              const kind = agents.get(id)?.kind;
              if (openHall && (kind === 'expert' || kind === 'council')) {
                openHall(id);
                stage.focus({ preventScroll: true });
                return;
              }
              if (I.opts.inspector) {
                inspector.select(id);
                // keyboard users stay on the chip so the panel can take focus; mouse users keep the stage
                const a = stage.ownerDocument.activeElement as HTMLElement | null;
                if (!a?.matches?.(':focus-visible')) stage.focus({ preventScroll: true });
                return;
              }
              const a = agents.get(id);
              const slot = a?.slotId ? layout.slots.find((s) => s.id === a.slotId) : undefined;
              if (slot) void player.walkTo(slot.door?.x ?? slot.x);
              bus.emit('overlay', { type: 'focusAgent', agent: id });
              lock.unlock?.();
              lock.unlock = undefined; // focus is a hint to the host, it does not open a blocking overlay
              stage.focus({ preventScroll: true });
            },
          });

    this.parts = [
      { update: (t, dt) => time.update(dt), destroy() {} },
      { update: (t) => parallax.update(t), destroy: () => parallax.destroy() },
      { update: (t, dt) => player.update(t, dt), destroy: () => player.destroy() },
      { update: (t, dt) => camera.update(t, dt), destroy: () => camera.destroy() },
      { update: (t, dt) => input.update(t, dt), destroy: () => input.destroy() },
      { update: () => dressing.update(), destroy: () => dressing.destroy() },
      { update: (t, dt) => lighting.update(t, dt), destroy: () => lighting.destroy() },
      ...(hud ? [{ update: () => hud.update(), destroy: () => hud.destroy() }] : []),
    ];
    this.events.once('shutdown', () => this.teardown());
    this.events.once('destroy', () => this.teardown());
    this.cameraSet = (m) => camera.setMode(m);

    // modules: private preload first (queued through the real loader), then create in order
    for (const m of I.modules) {
      try {
        m.preload?.(ctx, this.load);
      } catch (e) {
        I.log(`module ${m.id} preload failed`, e);
      }
    }
    const finish = () => this.finishCreate(ctx, agents, bus, hud ? 1 : 0);
    if (this.load.list.size > 0) {
      this.load.once('complete', finish);
      this.load.start();
    } else finish();
  }

  private finishCreate(
    ctx: VillageContext,
    agents: ReturnType<typeof createAgentRegistry>,
    bus: ReturnType<typeof createBus>,
    _h: number,
  ) {
    const I = this.init_;
    const inspector_ = this.registry.get('inspector') as InspectorStore;
    const time = ctx.time;
    void _h;
    for (const mod of I.modules) {
      try {
        const inst = mod.create(ctx);
        if (inst) this.instances.push({ mod, inst });
      } catch (e) {
        I.log(`module ${mod.id} create failed`, e);
      }
    }

    // events -> adapter -> commands
    const adapter = I.adapter?.createAdapter({ me: I.opts.me });
    const handle = (raw: unknown) => {
      const p = VillageEventSchema.safeParse(raw);
      if (!p.success) {
        I.log('ignored malformed event', p.error.message);
        return;
      }
      const e: VillageEvent = p.data;
      if (e.t === 'agent.state') agents.setState(e.agent, e.state);
      bus.emit('villageEvent', e);
      let cmds: SceneCommand[] = [];
      try {
        cmds = adapter?.adapt(e) ?? [];
      } catch (err) {
        I.log('adapter threw', err);
      }
      for (const c of cmds) {
        bus.emit('command', c);
        for (const { mod, inst } of this.instances) {
          try {
            inst.onCommand?.(c);
          } catch (err) {
            I.log(`module ${mod.id} onCommand threw`, err);
          }
        }
      }
    };
    const source: VillageSource = I.opts.source;
    if (!I.opts.inspector) this.unsubs.push(inspector_.attach(source));
    this.unsubs.push(source.subscribe(handle));

    // initial calm / camera from options
    void time;
  }

  cameraSet: (m: CameraMode) => void = () => {};
  private tornDown = false;
  private teardown() {
    if (this.tornDown) return;
    this.tornDown = true;
    this.unsubs.forEach((u) => u());
    this.instances.forEach(({ inst, mod }) => {
      try {
        inst.destroy?.();
      } catch (e) {
        this.init_.log(`module ${mod.id} destroy failed`, e);
      }
    });
    this.parts.forEach((p) => p.destroy());
  }

  override update(t: number, dt: number) {
    const d = Math.min(dt, 50); // never catch up after a pause
    for (const p of this.parts) p.update(t, d);
    for (const { inst } of this.instances) inst.update?.(t, d);
    if (!this.ready && ++this.frames >= 2) {
      this.ready = true;
      this.init_.onReady();
    }
  }
}
