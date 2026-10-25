import type { Animatable, Walker } from './prims';

/** Master palette (mirrors docs/design/tokens.css --sq-*; canvas cannot read CSS vars headless). */
export const PAL = {
  ink: 0x070f1f,
  skyDeep: 0x0b1d38,
  skyMid: 0x0a3a63,
  skyLow: 0x0c6e9e,
  cloudLo: 0x6fa3b8,
  cloudHi: 0xb4d6da,
  moon: 0xfff2c4,
  hillFar: 0x4a7695,
  hillMid: 0x2f5f84,
  hillNear: 0x1c4466,
  ground: 0x122b3f,
  leafDark: 0x0d3a4f,
  leafLit: 0x22808a,
  wallLit: 0xc9d4e4,
  wallMid: 0x8c9bb8,
  wallShade: 0x56648a,
  roofWine: 0x7a3552,
  roofShade: 0x4a2440,
  woodLit: 0xb07a52,
  wood: 0x6e4a3c,
  woodDark: 0x3a2634,
  glowCore: 0xfff0a8,
  glow: 0xffc857,
  ember: 0xf08a3a,
  alert: 0xe0485a,
  ok: 0x5fcf8a,
  skin: 0xf3cfae,
  violet: 0x8f7bff,
} as const;

export type NodeKind =
  | 'rect' // origin top-left, w x h
  | 'circle' // origin centre, diameter w
  | 'ring' // origin centre, diameter w, 1 px outline
  | 'text' // origin top-left, 3x5 pixel font
  | 'bubble' // origin = speaker-side tail point (bottom centre); body above it
  | 'envelope' // origin bottom centre
  | 'sprite' // sprite-block, origin bottom centre (feet), frames 0..3
  | 'house' // origin bottom centre
  | 'fire' // campfire, frames 0..3
  | 'smoke' // chimney smoke, frames 0..2
  | 'door' // origin bottom centre
  | 'window' // lit window, alpha is the flicker
  | 'speaker' // speaker block (speaking sprite)
  | 'marker' // "!" emote
  | 'check' // check mark, drawn by reveal 0..1
  | 'lock' // frame 0 closed, 1 open
  | 'lantern' // frames 0..2
  | 'overlay' // full-viewport fade plane (fixed)
  | 'card' // static card with text
  | 'tiles'; // repeating layer, variant in `text`: hill | cloud | road

export interface NodeInit {
  kind: NodeKind;
  id?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: number;
  text?: string;
  alpha?: number;
  scaleX?: number;
  scaleY?: number;
  visible?: boolean;
  fixed?: boolean;
  scrollFactor?: number;
  tint?: number | null;
}

/** One 2D scene node. Implements Animatable plus the optional hooks primitives call. */
export class StageNode implements Animatable, Walker {
  readonly kind: NodeKind;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  visible: boolean;
  color: number;
  tint: number | null;
  text: string;
  frame = 0;
  reveal = 1;
  facing: 'left' | 'right' | 'up' | 'down' = 'right';
  tilePositionX = 0;
  scrollFactor: number;
  /** Fixed nodes ignore the camera (HUD, overlay). */
  fixed: boolean;

  constructor(i: NodeInit) {
    this.kind = i.kind;
    this.id = i.id ?? i.kind;
    this.x = i.x ?? 0;
    this.y = i.y ?? 0;
    this.w = i.w ?? 0;
    this.h = i.h ?? 0;
    this.alpha = i.alpha ?? 1;
    this.scaleX = i.scaleX ?? 1;
    this.scaleY = i.scaleY ?? 1;
    this.visible = i.visible ?? true;
    this.color = i.color ?? PAL.wallLit;
    this.tint = i.tint ?? null;
    this.text = i.text ?? '';
    this.fixed = i.fixed ?? false;
    this.scrollFactor = i.scrollFactor ?? 1;
  }
  setTint(rgb: number): void {
    this.tint = rgb;
  }
  setFrame(i: number): void {
    this.frame = i;
  }
  setReveal(p: number): void {
    this.reveal = p;
  }
  setFacing(d: 'left' | 'right' | 'up' | 'down'): void {
    this.facing = d;
  }
}

/** A small 2D scene model. Logical size is 320x180; the renderer scales by an integer. */
export class Stage {
  readonly w = 320;
  readonly h = 180;
  /** Sky colour; dayNight drives it through setTint. */
  sky: number = PAL.skyMid;
  readonly cam = { scrollX: 0, scrollY: 0 };
  /** Static text label shown by reduced-motion variants (row 10 "waiting"). */
  label: string | null = null;
  readonly nodes: StageNode[] = [];

  add(init: NodeInit): StageNode {
    const n = new StageNode(init);
    this.nodes.push(n);
    return n;
  }

  setTint(rgb: number): void {
    this.sky = rgb;
  }

  find(id: string): StageNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /** Plain-data copy of everything that can change; used for determinism checks. */
  snapshot(): unknown {
    return {
      sky: this.sky,
      cam: { ...this.cam },
      label: this.label,
      nodes: this.nodes.map((n) => [
        n.id,
        n.x,
        n.y,
        n.alpha,
        n.scaleX,
        n.scaleY,
        n.visible,
        n.tint,
        n.frame,
        n.reveal,
        n.tilePositionX,
        n.facing,
      ]),
    };
  }
}
