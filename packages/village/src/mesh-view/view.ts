import type { VillageContext, ModuleInstance, SceneCommand as WorldCommand } from '../world/api';
import { parseAgentId } from '@squad/core';
import { studentName } from '../adapter';
import type { Place, SceneCommand } from '../adapter';
import { createDirector, type FocusTarget, type Shot } from '../director';
import { createActors } from './actors';
import type { Actor } from './actors';
import { createBubbles } from './bubbles';
import { createEffects } from './effects';
import { createEnvelopes } from './envelopes';
import { createHomes } from './homes';
import { createPlaceResolver } from './places';
import { createBoard, createCampfire } from './props';
import { nextStagger } from './util';

const BUBBLE_LANE_COMMONS = 'commons';
const BUBBLE_LANE_BOARD = 'board';
const RETURN_DELAY_MS = 900;
/** The stage: campfire, board and the viewer's house share one 427 px view when centred here. */
const STAGE_DX = 40;

/**
 * The mesh view: neighbour houses with locked doors, campfire commons, envelopes carried and handed
 * over, speech bubbles with shared fields only, red "!" markers, door rings while waiting for a yes,
 * and the notice board (disclosure ledger). It executes SceneCommands and holds no business state.
 */
export function createMeshView(
  ctx: VillageContext,
): ModuleInstance & { debug: { actors(): string[] } } {
  const homes = createHomes(ctx);
  const places = createPlaceResolver(ctx, (id) => homes.doorXFor(id));
  const actors = createActors(ctx);
  const bubbles = createBubbles(ctx);
  const fx = createEffects(ctx);
  const envs = createEnvelopes(ctx);
  const camp = createCampfire(ctx);
  const board = createBoard(ctx);
  const g = ctx.layout.groundY;
  let visitors = 0;
  let pinIndex = 0;
  let destroyed = false;
  const handOffStarts: number[] = []; // concurrent hand-offs stagger by 60 ms each (spec 08 row 7)

  /**
   * Camera director binding. The pure director (src/director) decides which Place the camera should look at from
   * the same SceneCommands the scenes execute; this resolves a Place to an x in this side-view world and performs the
   * move with the 400 ms ease-in-out pan (a jump cut in Calm mode). It yields to the viewer: key, tap, walking or a
   * camera button silence it for 5 s and end the current hold.
   */
  const director = createDirector({ calm: () => ctx.calm });
  const shotLog: Array<Record<string, unknown>> = [];
  ctx.registry.set('director.log', shotLog);
  let walkingPrev = false;
  const userTouched = (): void => {
    director.userInput(ctx.scene.time.now);
    ctx.camera.release?.(true);
  };
  const offs: Array<() => void> = [];
  offs.push(ctx.bus.on('cameraMode', () => director.userInput(ctx.scene.time.now)));
  const kb = ctx.scene.input.keyboard;
  kb?.on('keydown', userTouched);
  ctx.scene.input.on('pointerdown', userTouched);
  offs.push(() => {
    kb?.off('keydown', userTouched);
    ctx.scene.input.off('pointerdown', userTouched);
  });

  /** Campfire, board and the viewer's house share one view when there is room (427 px wide at 3x). */
  const stageX = (): number => (ctx.scene.cameras.main.width >= 400 ? camp.x + STAGE_DX : camp.x);
  const targetX = (t: FocusTarget): number | undefined => {
    switch (t.kind) {
      case 'commons':
        return stageX();
      case 'board':
        return ctx.scene.cameras.main.width >= 400 ? stageX() : places.board.x;
      case 'agent': {
        const a = actorFor(t.agent);
        return a ? a.sprite.x : places.doorX(t.agent);
      }
      case 'door':
        if (parseAgentId(t.agent).kind === 'mediator') return undefined;
        return homes.isMine(t.agent) ? stageX() : places.doorX(t.agent);
      default:
        return places.resolve(t)?.x;
    }
  };
  const takeShot = (shot: Shot): void => {
    const x = targetX(shot.target);
    const cam = ctx.scene.cameras.main;
    const entry: Record<string, unknown> = {
      t: Math.round(ctx.scene.time.now),
      key: shot.key,
      reason: shot.reason,
      score: shot.score,
      x,
      jump: shot.jump,
    };
    shotLog.push(entry);
    if (shotLog.length > 400) shotLog.shift();
    if (x === undefined) return;
    const center = cam.scrollX + cam.width / 2;
    entry.panned = Math.abs(x - center) > cam.width * 0.3; // already comfortably framed: leave it
    if (entry.panned) void ctx.camera.panTo(Math.round(x), { holdMs: shot.holdMs });
  };

  const actorFor = (agentId: string): Actor | undefined => {
    if (parseAgentId(agentId).kind === 'mediator') return undefined; // the mediator never appears as a person
    return actors.get(agentId, places.doorX(agentId));
  };

  const markerPos = (at: Place): { x: number; y: number } | undefined => {
    if (at.kind === 'commons') return { x: camp.x, y: g - 34 };
    const p = places.resolve(at);
    return p ? { x: p.x, y: g - 138 } : undefined; // above the roof ridge: clear of the name sign
  };

  const bubbleAnchor = (
    at: Place | { kind: 'agent'; agent: string },
  ): (() => { x: number; y: number } | undefined) => {
    if (at.kind === 'agent') {
      const a = actorFor(at.agent);
      return () => (a ? { x: a.sprite.x, y: a.sprite.y - 36 } : undefined);
    }
    if (at.kind === 'commons') return () => ({ x: camp.x, y: g - 46 });
    if (at.kind === 'board') return () => board.anchor();
    const p = places.resolve(at);
    return () => (p ? { x: p.x, y: g - 100 } : undefined);
  };

  const onCommand = (raw: WorldCommand): void => {
    if (destroyed) return;
    const cmd = raw as unknown as SceneCommand;
    director.observe(cmd, ctx.scene.time.now);
    switch (cmd.type) {
      case 'setAgentState':
        if (parseAgentId(cmd.agent).kind === 'student')
          homes.setLit(cmd.agent, cmd.state !== 'idle');
        break;

      case 'ring': {
        if (parseAgentId(cmd.agent).kind === 'mediator') break;
        const x = places.doorX(cmd.agent);
        if (cmd.on) {
          actorFor(cmd.agent); // the agent steps out to its door while waiting
        }
        fx.ring(cmd.agent, x, cmd.on);
        break;
      }

      case 'tick': {
        if (cmd.at.kind !== 'door') break;
        const x = places.doorX(cmd.at.agent);
        fx.tick(x, cmd.at.agent);
        homes.unlockFor(cmd.at.agent);
        break;
      }

      case 'spawnEnvelope': {
        const carrier = actorFor(cmd.from);
        const at = { x: places.doorX(cmd.from), y: g - 33 };
        envs.spawn(
          cmd.id,
          cmd.to,
          carrier ? { x: carrier.sprite.x, y: carrier.sprite.y - 33 } : at,
          carrier,
        );
        break;
      }

      case 'walkTo': {
        const actor = actorFor(cmd.agent);
        const dest = places.resolve(cmd.to);
        if (!actor || !dest) break;
        const atCommons = cmd.to.kind === 'commons';
        const x = atCommons ? camp.visitorSpot(visitors++) : dest.x;
        actor.showTag(true);
        void actor.walkTo(x).then(() => {
          if (destroyed) return;
          const env = cmd.carrying ? envs.get(cmd.carrying) : undefined;
          if (env) handOff(env, actor);
          else actor.showTag(false);
          if (atCommons) {
            // walk home again after a beat
            ctx.scene.time.delayedCall(RETURN_DELAY_MS + (env ? 360 : 0), () => {
              if (destroyed) return;
              visitors = Math.max(0, visitors - 1);
              void actor.walkTo(actor.home).then(() => actor.showTag(false));
            });
          }
        });
        break;
      }

      case 'showBubble': {
        bubbles.show({
          key: cmd.key,
          text: cmd.text,
          ...(cmd.lines ? { lines: cmd.lines } : {}),
          minMs: cmd.minMs,
          ...(cmd.tone ? { tone: cmd.tone } : {}),
          ...(cmd.tone && cmd.at.kind === 'commons' ? { icon: false } : {}),
          anchor: bubbleAnchor(cmd.at),
          ...(cmd.at.kind === 'commons'
            ? { lane: BUBBLE_LANE_COMMONS }
            : cmd.at.kind === 'board'
              ? { lane: BUBBLE_LANE_BOARD }
              : {}),
        });
        break;
      }
      case 'dismissBubble':
        bubbles.dismiss(cmd.key);
        break;

      case 'marker': {
        const p = markerPos(cmd.at);
        if (p) {
          fx.marker(cmd.key, p.x, p.y);
        }
        break;
      }
      case 'clearMarker':
        fx.clearMarker(cmd.key);
        break;

      case 'ledgerCard': {
        board.pin(cmd.card);
        const who = studentName(cmd.student);
        const c = cmd.card;
        const spec =
          c.kind === 'shared'
            ? { text: `${who} shared ${c.field}`, lines: [c.shared] }
            : c.kind === 'hidden'
              ? { text: `${who} kept ${c.field}`, lines: ['hidden'] }
              : { text: 'Blocked by privacy gate', lines: [c.field] };
        const text = [spec.text, ...spec.lines].join(' ');
        bubbles.show({
          key: `ledger:${cmd.taskId}:${cmd.student}:${c.field}`,
          text: spec.text,
          lines: spec.lines,
          bullets: false,
          minMs: Math.min(9000, Math.max(1200, Math.ceil(text.length / 20) * 1200)),
          ...(c.kind === 'blocked' ? { tone: 'alert' as const } : {}),
          anchor: () => board.anchor(),
          lane: BUBBLE_LANE_BOARD,
        });
        break;
      }

      default:
        break; // other commands belong to scenes, cutscene and a11y; unknown ones are ignored
    }
  };

  /** Envelope arrives with its carrier at the commons: pin at the fire, or glide to the recipient's door. */
  const handOff = (env: ReturnType<typeof envs.get> & object, carrier: Actor) => {
    const staggerIndex = nextStagger(handOffStarts, ctx.scene.time.now);
    if (env.to === 'commons') {
      envs.glide(env, camp.pinSpot(pinIndex++), {
        rest: true,
        staggerIndex,
        onDone: () => carrier.showTag(false),
      });
      return;
    }
    const dx = places.doorX(env.to);
    actorFor(env.to); // recipient steps out to receive
    envs.glide(
      env,
      { x: dx, y: g - 36 },
      { rest: false, staggerIndex, onDone: () => carrier.showTag(false) },
    );
  };

  return {
    onCommand,
    update(now) {
      const t = ctx.scene.time.now;
      if (ctx.player.isWalking && !walkingPrev) userTouched();
      walkingPrev = ctx.player.isWalking;
      const act = director.tick(t);
      if (act?.action === 'shot') takeShot(act);
      else if (act?.action === 'release') ctx.camera.release?.();
      void now;
      actors.update();
      envs.update();
      bubbles.update();
      camp.update();
      homes.update();
    },
    destroy() {
      destroyed = true;
      offs.forEach((f) => f());
      bubbles.destroy();
      envs.destroy();
      fx.destroy();
      actors.destroy();
      camp.destroy();
      board.destroy();
      homes.destroy();
    },
    debug: { actors: () => [] },
  };
}
