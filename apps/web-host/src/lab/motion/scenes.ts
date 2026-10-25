import {
  CURVES,
  bubbleHoldMs,
  buildingTransition,
  cameraPan,
  carryEnvelope,
  chairmanVerdict,
  cloudDrift,
  confirmTick,
  conflictMarker,
  councilOpinions,
  councilRank,
  dayNight,
  frameLoop,
  handOff,
  lanternFlicker,
  litWindow,
  parallaxStep,
  ringToCheck,
  showBubble,
  speaking,
  tripCutscene,
  waitingRing,
  walkTo,
  type MotionRuntime,
} from './prims';
import type { Stage} from './stage';
import { PAL, type StageNode } from './stage';

export type DomDemo = 'panel' | 'chip' | 'press' | 'badge' | 'fade';

export interface LabScene {
  /** m1..m21 */
  id: string;
  /** Row in the 08 table, 1..21. */
  row: number;
  title: string;
  purpose: string;
  curveLabel: string;
  durationLabel: string;
  reducedLabel: string;
  /** One loop of the scene in ms (includes a short rest at the end). */
  loopMs: number;
  kind: 'canvas' | 'dom';
  /** DOM demo variant: all of rows 16/18/19/21 and the DOM half of row 15. */
  domDemo?: DomDemo;
  /** Populate the stage and start the real primitive(s). Must read rt.reduced at call time. */
  build(rt: MotionRuntime, stage: Stage): void;
}

/* ---------- small scene furniture ---------- */

function ground(s: Stage, w = 320): void {
  s.add({ kind: 'rect', id: 'ground', x: 0, y: 140, w, h: 40, color: PAL.ground });
}
function house(s: Stage, x: number, id = 'house', roof: number = PAL.roofWine): StageNode {
  return s.add({ kind: 'house', id, x, y: 140, w: 40, h: 36, color: roof });
}
function cloneWalker(s: Stage, x: number, y: number, id = 'walker'): StageNode {
  return s.add({ kind: 'sprite', id, x, y, w: 10, h: 14, color: PAL.glow });
}
const NOOP = (): void => {};

/* ---------- the 21 rows ---------- */

export const SCENES: LabScene[] = [
  {
    id: 'm1',
    row: 1,
    title: 'Parallax drift',
    purpose: 'Spatial consistency: far layers move less than near ones, clouds drift.',
    curveLabel: 'linear; layer factors 0.1 / 0.3 / 0.6; clouds 1 px/s (Lab shows 8 px/s)',
    durationLabel: 'ambient, always',
    reducedLabel: 'Layers stop (no camera scroll, no cloud drift)',
    loopMs: 8000,
    kind: 'canvas',
    build(rt, s) {
      const cloud = s.add({
        kind: 'tiles',
        id: 'cloud',
        text: 'cloud',
        y: 40,
        h: 12,
        w: 320,
        color: PAL.cloudHi,
      });
      const far = s.add({
        kind: 'tiles',
        id: 'far',
        text: 'hill',
        y: 120,
        h: 18,
        w: 320,
        color: PAL.hillFar,
      });
      const mid = s.add({
        kind: 'tiles',
        id: 'mid',
        text: 'hill',
        y: 140,
        h: 16,
        w: 320,
        color: PAL.hillMid,
      });
      const near = s.add({
        kind: 'tiles',
        id: 'near',
        text: 'hill',
        y: 166,
        h: 12,
        w: 320,
        color: PAL.hillNear,
      });
      const layers = [
        { scrollFactor: 0.1, tile: far },
        { scrollFactor: 0.3, tile: mid },
        { scrollFactor: 0.6, tile: near },
      ];
      parallaxStep(layers, 0);
      cloudDrift(rt, cloud, { pxPerSec: 8 });
      if (!rt.reduced) {
        const cam = { x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 };
        rt.tween(
          cam,
          { x: 400 },
          {
            duration: 7600,
            curve: CURVES.linear,
            onUpdate: () => parallaxStep(layers, cam.x),
          },
        );
      }
    },
  },
  {
    id: 'm2',
    row: 2,
    title: 'Day/night shift',
    purpose: 'State indication: the sky tint changes at dusk or dawn only.',
    curveLabel: 'ease-in-out colour lerp',
    durationLabel: '20 s',
    reducedLabel: 'Snap with a 200 ms fade',
    loopMs: 21000,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      house(s, 120);
      s.add({ kind: 'window', id: 'window', x: 120, y: 128, w: 6, h: 6, color: PAL.glow });
      s.add({ kind: 'circle', id: 'moon', x: 260, y: 40, w: 14, color: PAL.moon });
      dayNight(rt, s, { from: PAL.skyLow, to: PAL.skyDeep, at: 'dusk' });
    },
  },
  {
    id: 'm3',
    row: 3,
    title: 'Walk cycle',
    purpose: 'Direct control: constant-speed walking with a short ease-out stop.',
    curveLabel: 'linear, constant speed, 80 ms ease-out stop; 4 frames at 8 fps',
    durationLabel: '48 px/s',
    reducedLabel: 'Teleport to the target with a 120 ms fade',
    loopMs: 5600,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      s.add({ kind: 'rect', id: 'from', x: 24, y: 143, w: 2, h: 2, color: PAL.cloudLo });
      s.add({ kind: 'rect', id: 'to', x: 248, y: 143, w: 2, h: 2, color: PAL.ok });
      const w = cloneWalker(s, 24, 144);
      walkTo(rt, w, { x: 248, y: 144 });
    },
  },
  {
    id: 'm4',
    row: 4,
    title: 'Idle breathing',
    purpose: 'State indication: two frames at 2 fps.',
    curveLabel: 'n/a (frame loop)',
    durationLabel: '2 frames at 2 fps',
    reducedLabel: 'Static frame',
    loopMs: 4000,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      const w = cloneWalker(s, 160, 144, 'idle');
      frameLoop(rt, (i) => w.setFrame(i), { frames: 2, fps: 2 });
    },
  },
  {
    id: 'm5',
    row: 5,
    title: 'Lit window flicker',
    purpose: 'State indication: the agent is awake.',
    curveLabel: 'alpha 0.85 to 1, ease-in-out',
    durationLabel: '4 s loop',
    reducedLabel: 'Steady lit window',
    loopMs: 4000,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      house(s, 160);
      const win = s.add({
        kind: 'window',
        id: 'window',
        x: 160,
        y: 128,
        w: 8,
        h: 8,
        color: PAL.glow,
      });
      litWindow(rt, win);
    },
  },
  {
    id: 'm6',
    row: 6,
    title: 'Chimney smoke, campfire',
    purpose: 'State indication: looping FX sprites.',
    curveLabel: 'frame loop (campfire 4 frames at 8 fps, smoke 3 frames at 3 fps)',
    durationLabel: 'ambient',
    reducedLabel: 'Single frame',
    loopMs: 2000,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      house(s, 90);
      const smoke = s.add({ kind: 'smoke', id: 'smoke', x: 100, y: 96 });
      const fire = s.add({ kind: 'fire', id: 'fire', x: 220, y: 140 });
      frameLoop(rt, (i) => fire.setFrame(i), { frames: 4, fps: 8 });
      frameLoop(rt, (i) => smoke.setFrame(i), { frames: 3, fps: 3 });
    },
  },
  {
    id: 'm7',
    row: 7,
    title: 'Envelope carried to commons',
    purpose: 'Explanation: a message travels from a door to the campfire, then fans out.',
    curveLabel: 'walk linear; pop 180 ms ease-out; hand-off 320 ms ease-in-out; 60 ms stagger',
    durationLabel: '~3.5 s',
    reducedLabel: 'Walker teleports; envelopes fade at the destination',
    loopMs: 4800,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      house(s, 50);
      s.add({ kind: 'door', id: 'door', x: 50, y: 140, w: 8, h: 14 });
      s.add({ kind: 'fire', id: 'fire', x: 190, y: 140 });
      const walker = cloneWalker(s, 50, 142);
      const envs = [0, 1, 2].map((i) =>
        s.add({ kind: 'envelope', id: `env${i}`, x: 50, y: 130, w: 10, h: 7, visible: i === 0 }),
      );
      const spots = [
        { x: 250, y: 100 },
        { x: 270, y: 120 },
        { x: 290, y: 138 },
      ];
      const fireAt = { x: 190, y: 128 };
      carryEnvelope(rt, {
        walker,
        envelope: envs[0]!,
        from: { x: 50, y: 142 },
        to: { x: 178, y: 142 },
        onArrive: () => {
          envs.forEach((e, i) => {
            e.visible = true;
            if (i > 0) {
              e.x = fireAt.x;
              e.y = fireAt.y;
              e.alpha = 1;
            }
            handOff(rt, { envelope: e, from: fireAt, to: spots[i]!, staggerIndex: i });
          });
        },
      });
    },
  },
  {
    id: 'm8',
    row: 8,
    title: 'Speech bubble',
    purpose: 'Feedback: a bubble pops about the speaker; text is whole on frame 1.',
    curveLabel: '160 ms ease-out scale .95 to 1 plus alpha; exit 120 ms ease-out',
    durationLabel: '160 ms in, hold by length, 120 ms out',
    reducedLabel: 'Fade only, no scale',
    loopMs: 2400,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      s.add({ kind: 'speaker', id: 'speaker', x: 110, y: 144, w: 12, h: 18 });
      const text = 'Ready to study?';
      const b = s.add({ kind: 'bubble', id: 'bubble', x: 116, y: 124, w: 80, h: 20, text });
      showBubble(rt, b, { text, holdMs: bubbleHoldMs(text) });
    },
  },
  {
    id: 'm9',
    row: 9,
    title: 'Conflict "!" marker',
    purpose: 'State indication: one pop, red tint holds, never a shake.',
    curveLabel: 'spring bounce 0.2',
    durationLabel: '0.35 s',
    reducedLabel: 'No pop, static marker',
    loopMs: 1600,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      s.add({ kind: 'speaker', id: 'speaker', x: 160, y: 144, w: 12, h: 18 });
      const m = s.add({
        kind: 'marker',
        id: 'marker',
        x: 160,
        y: 114,
        w: 5,
        h: 9,
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.6,
      });
      conflictMarker(rt, m);
    },
  },
  {
    id: 'm10',
    row: 10,
    title: 'Waiting-for-yes ring',
    purpose: 'State indication: a ring pulses at the door while a yes is pending.',
    curveLabel: 'scale 1 to 1.15, alpha .6 to 0, ease-out',
    durationLabel: '1.6 s loop',
    reducedLabel: 'Static ring plus a "waiting" label',
    loopMs: 3200,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      s.add({ kind: 'door', id: 'door', x: 160, y: 140, w: 12, h: 20 });
      const ring = s.add({
        kind: 'ring',
        id: 'ring',
        x: 160,
        y: 126,
        w: 36,
        color: PAL.ember,
        alpha: 0,
      });
      waitingRing(rt, ring, {
        onStaticLabel: (show) => {
          s.label = show ? 'WAITING' : null;
        },
      });
    },
  },
  {
    id: 'm11',
    row: 11,
    title: 'Ring becomes check, lock opens',
    purpose: 'Feedback: the yes arrives.',
    curveLabel: 'ease-out reveal; lock frame swaps at 50%',
    durationLabel: '200 ms',
    reducedLabel: 'Instant swap',
    loopMs: 1600,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      s.add({ kind: 'door', id: 'door', x: 160, y: 140, w: 12, h: 20 });
      const lock = s.add({ kind: 'lock', id: 'lock', x: 160, y: 112, w: 7, h: 8 });
      const ring = s.add({
        kind: 'ring',
        id: 'ring',
        x: 160,
        y: 126,
        w: 36,
        color: PAL.ember,
        alpha: 0.6,
      });
      const check = s.add({
        kind: 'check',
        id: 'check',
        x: 160,
        y: 130,
        w: 14,
        h: 10,
        color: PAL.ok,
        visible: false,
      });
      check.setReveal(0);
      rt.after(400, () => {
        ringToCheck(rt, { ring, check, lock: { setFrame: (i) => lock.setFrame(i), openFrame: 1 } });
        confirmTick(
          rt,
          s.add({ kind: 'check', id: 'tick', x: 196, y: 70, w: 8, h: 6, color: PAL.ok }),
        );
      });
    },
  },
  {
    id: 'm12',
    row: 12,
    title: 'Council: opinions, ranking, verdict',
    purpose: 'Explanation: thought bubbles, slide to rank slots, chairman verdict.',
    curveLabel: 'stagger 80 ms ease-out; slide 320 ms ease-in-out; chairman 240 ms ease-out',
    durationLabel: '~2 s',
    reducedLabel: 'Bubbles fade in order',
    loopMs: 3200,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      const names = ['PLAN A', 'PLAN B', 'PLAN C'];
      const xs = [60, 160, 260];
      const bubbles = names.map((t, i) =>
        s.add({ kind: 'bubble', id: `op${i}`, x: xs[i]!, y: 60, w: 48, h: 16, text: t, alpha: 0 }),
      );
      const chair = s.add({
        kind: 'bubble',
        id: 'chair',
        x: 160,
        y: 60,
        w: 72,
        h: 16,
        text: 'VERDICT B',
        alpha: 0,
        color: PAL.glow,
      });
      councilOpinions(rt, bubbles);
      rt.after(900, () =>
        councilRank(rt, [
          { bubble: bubbles[0]!, to: { x: 260, y: 120 } },
          { bubble: bubbles[1]!, to: { x: 60, y: 120 } },
          { bubble: bubbles[2]!, to: { x: 160, y: 120 } },
        ]),
      );
      rt.after(1800, () => chairmanVerdict(rt, chair));
    },
  },
  {
    id: 'm13',
    row: 13,
    title: 'Dissent lantern',
    purpose: 'State indication: a rare red lantern flickers.',
    curveLabel: 'ease-in-out alpha, 3 frames',
    durationLabel: '2 s',
    reducedLabel: 'Steady red lantern',
    loopMs: 4000,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      const l = s.add({
        kind: 'lantern',
        id: 'lantern',
        x: 160,
        y: 130,
        w: 10,
        h: 16,
        color: PAL.alert,
      });
      lanternFlicker(rt, l);
    },
  },
  {
    id: 'm14',
    row: 14,
    title: 'Camera pan to a building',
    purpose: 'Spatial consistency: the camera glides to a building and back.',
    curveLabel: 'ease-in-out, skippable',
    durationLabel: '400 ms',
    reducedLabel: 'Jump cut',
    loopMs: 2400,
    kind: 'canvas',
    build(rt, s) {
      ground(s, 520);
      house(s, 50, 'h1');
      house(s, 230, 'h2', PAL.roofShade);
      house(s, 420, 'h3');
      s.add({
        kind: 'text',
        id: 'hud',
        x: 6,
        y: 6,
        text: 'CAMERA',
        fixed: true,
        color: PAL.cloudHi,
      });
      rt.after(300, () => cameraPan(rt, s.cam, { x: 180, y: 0 }));
      rt.after(1300, () => cameraPan(rt, s.cam, { x: 0, y: 0 }));
    },
  },
  {
    id: 'm15',
    row: 15,
    title: 'Enter or leave a building',
    purpose: 'Prevent a jarring change: fade through ink at the midpoint (DOM half below).',
    curveLabel: 'ease-out fade',
    durationLabel: '200 ms',
    reducedLabel: '120 ms fade',
    loopMs: 1800,
    kind: 'canvas',
    domDemo: 'fade',
    build(rt, s) {
      ground(s);
      const outside = house(s, 160);
      const room = s.add({
        kind: 'rect',
        id: 'room',
        x: 60,
        y: 40,
        w: 200,
        h: 100,
        color: PAL.woodDark,
        visible: false,
      });
      const sign = s.add({
        kind: 'text',
        id: 'sign',
        x: 70,
        y: 50,
        text: 'INSIDE',
        color: PAL.glow,
        visible: false,
      });
      const overlay = s.add({
        kind: 'overlay',
        id: 'overlay',
        x: 0,
        y: 0,
        w: 320,
        h: 180,
        color: PAL.ink,
        alpha: 0,
        fixed: true,
        visible: false,
      });
      const swap = (inside: boolean) => (): void => {
        outside.visible = !inside;
        room.visible = inside;
        sign.visible = inside;
      };
      buildingTransition(rt, { direction: 'enter', overlay, onMidpoint: swap(true) });
      rt.after(900, () =>
        buildingTransition(rt, { direction: 'leave', overlay, onMidpoint: swap(false) }),
      );
    },
  },
  {
    id: 'm16',
    row: 16,
    title: 'Overlay panels',
    purpose: 'Spatial consistency: call, quiz and ledger panels slide in from 8 px.',
    curveLabel: 'ease-drawer, translateY(8px) plus opacity; exit mirrors entry',
    durationLabel: '200 to 280 ms (.m-panel 240 ms)',
    reducedLabel: 'Opacity only',
    loopMs: 1600,
    kind: 'dom',
    domDemo: 'panel',
    build: NOOP,
  },
  {
    id: 'm17',
    row: 17,
    title: 'Speaking sprite and portrait',
    purpose: 'State indication: the speaker bobs, the glow follows amplitude.',
    curveLabel: '2-frame swap at 8 fps, 2 px bob, glow alpha eased by amplitude (tau 80 ms)',
    durationLabel: 'while speaking',
    reducedLabel: 'Glow only, no bob',
    loopMs: 2400,
    kind: 'canvas',
    build(rt, s) {
      ground(s);
      const glow = s.add({
        kind: 'ring',
        id: 'glow',
        x: 130,
        y: 132,
        w: 30,
        color: PAL.glow,
        alpha: 0,
      });
      const sprite = s.add({ kind: 'speaker', id: 'speaker', x: 130, y: 144, w: 12, h: 18 });
      const portrait = s.add({
        kind: 'rect',
        id: 'portrait',
        x: 200,
        y: 100,
        w: 24,
        h: 24,
        color: PAL.wallMid,
      });
      const h = speaking(rt, { sprite, glow, portrait });
      h.setSpeaking(true);
      let t = 0;
      rt.spawn({
        update: (dt) => {
          t += dt;
          h.setAmplitude(0.55 + 0.45 * Math.sin(t / 160));
          return false;
        },
      });
      rt.after(1700, () => h.setSpeaking(false));
    },
  },
  {
    id: 'm18',
    row: 18,
    title: 'HUD portrait chip state change',
    purpose: 'Feedback: chip colour and opacity change when an agent changes state.',
    curveLabel: 'ease (colour, opacity)',
    durationLabel: '150 ms',
    reducedLabel: 'Same',
    loopMs: 1600,
    kind: 'dom',
    domDemo: 'chip',
    build: NOOP,
  },
  {
    id: 'm19',
    row: 19,
    title: 'Button press, camera buttons',
    purpose: 'Feedback: scale 0.97 on press; hover only for real pointers.',
    curveLabel: 'ease-out; hover only in (hover: hover) and (pointer: fine)',
    durationLabel: '100 to 160 ms',
    reducedLabel: 'Opacity change only',
    loopMs: 1600,
    kind: 'dom',
    domDemo: 'press',
    build: NOOP,
  },
  {
    id: 'm20',
    row: 20,
    title: 'Trip cutscene',
    purpose: 'Delight: the road scrolls, the vehicle drives off, the Trip door pops.',
    curveLabel: 'scroll ease-in-out; vehicle linear; door spring bounce 0.2; any key skips',
    durationLabel: '2.4 s scroll, 0.5 s door pop',
    reducedLabel: 'Static card with a 200 ms fade',
    loopMs: 3600,
    kind: 'canvas',
    build(rt, s) {
      s.sky = PAL.skyLow;
      const road = s.add({
        kind: 'tiles',
        id: 'road',
        text: 'road',
        y: 130,
        h: 30,
        w: 320,
        color: PAL.ground,
      });
      const vehicle = s.add({
        kind: 'rect',
        id: 'vehicle',
        x: 20,
        y: 114,
        w: 28,
        h: 14,
        color: PAL.ember,
      });
      const door = s.add({
        kind: 'door',
        id: 'trip',
        x: 250,
        y: 130,
        w: 14,
        h: 22,
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.6,
        color: PAL.woodLit,
      });
      const card = s.add({
        kind: 'card',
        id: 'card',
        x: 80,
        y: 50,
        w: 160,
        h: 24,
        text: 'OFF TO THE TRIP',
        alpha: 0,
        fixed: true,
      });
      tripCutscene(rt, { road, vehicle, tripDoor: door, card });
    },
  },
  {
    id: 'm21',
    row: 21,
    title: 'Replay/Live badge',
    purpose: 'State indication: the badge swaps between Replay and Live.',
    curveLabel: 'ease (opacity)',
    durationLabel: '150 ms',
    reducedLabel: 'Same',
    loopMs: 1600,
    kind: 'dom',
    domDemo: 'badge',
    build: NOOP,
  },
];

export function getScene(id: string): LabScene {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown motion lab scene: ${id}`);
  return s;
}
