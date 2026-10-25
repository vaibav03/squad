import type { VillageContext, ModuleInstance, SceneCommand as WorldCommand } from '../world/api';
import { parseAgentId } from '@squad/core';
import { studentName } from '../adapter';
import type { Place, SceneCommand } from '../adapter';
import { createActors } from './actors';
import type { Actor } from './actors';
import { createBubbles } from './bubbles';
import { createEffects } from './effects';
import { createEnvelopes } from './envelopes';
import { createHomes } from './homes';
import { createPlaceResolver } from './places';
import { createBoard, createCampfire } from './props';

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
  let lastPan = -Infinity;

  /**
   * Mesh activity can happen off-screen. When the focus is outside the view and the student is not walking
   * (never fights keyboard input, spec 08 row 3), bring it into view at most once per 6 s: the stage (campfire,
   * board, the viewer's house) is the world's Right preset, which holds until the student walks again; a single
   * door gets a 400 ms ease-in-out pan.
   */
  const focus = (x: number, stage = false): void => {
    const cam = ctx.scene.cameras.main;
    const now = ctx.scene.time.now;
    if (ctx.player.isWalking || now - lastPan < 6000) return;
    if (x > cam.scrollX + 40 && x < cam.scrollX + cam.width - 40) return;
    lastPan = now;
    if (stage) ctx.camera.setMode('right');
    else void ctx.camera.panTo(Math.round(x), { holdMs: 6000 });
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
          if (homes.isMine(cmd.agent)) focus(camp.x + STAGE_DX, true); // the viewer's own yes is the one to watch
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
        focus(camp.x + STAGE_DX, true);
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
          if (cmd.at.kind === 'commons') focus(camp.x + STAGE_DX, true);
          fx.marker(cmd.key, p.x, p.y);
        }
        break;
      }
      case 'clearMarker':
        fx.clearMarker(cmd.key);
        break;

      case 'ledgerCard': {
        focus(camp.x + STAGE_DX, true);
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
    if (env.to === 'commons') {
      envs.glide(env, camp.pinSpot(pinIndex++), {
        rest: true,
        onDone: () => carrier.showTag(false),
      });
      return;
    }
    const dx = places.doorX(env.to);
    actorFor(env.to); // recipient steps out to receive
    envs.glide(env, { x: dx, y: g - 36 }, { rest: false, onDone: () => carrier.showTag(false) });
  };

  return {
    onCommand,
    update() {
      actors.update();
      envs.update();
      bubbles.update();
      camp.update();
      homes.update();
    },
    destroy() {
      destroyed = true;
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
