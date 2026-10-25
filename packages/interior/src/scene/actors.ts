import type Phaser from 'phaser';
import type { Manifest } from '../assets/manifest';
import { PathFollower } from '../nav/follower';
import type { Vec } from '../nav/pathfinder';
import type { Dir } from '../tilemap/types';
import { DEPTH, SORT_BIAS, ysortDepth } from '../world/ysort';

export const WALK_SPEED = 56; // px/s, constant (3.5 tiles/s)
export const FEET_BOX = { w: 10, h: 6 };

export type MarkerKind = 'waiting' | 'check' | 'alert' | 'none';

/** A character on the floor: sprite, contact shadow, optional marker. Position is the FEET point in world px. */
export class Actor {
  x: number;
  y: number;
  dir: Dir = 'down';
  moving = false;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private marker: Phaser.GameObjects.Image | undefined;
  private markerKind: MarkerKind = 'none';
  follower: PathFollower | undefined;

  constructor(
    protected readonly scene: Phaser.Scene,
    protected readonly manifest: Manifest,
    readonly sheet: string,
    x: number,
    y: number,
    private readonly bias: number,
  ) {
    this.x = x;
    this.y = y;
    const a = manifest.characters.anchor;
    const f = manifest.characters.frame;
    this.shadow = scene.add.image(0, 0, 'interior.shadow').setDepth(DEPTH.shadows);
    this.sprite = scene.add.sprite(0, 0, `char.${sheet}`, 0).setOrigin(a.x / f.w, a.y / f.h);
    this.sync();
    this.play(false);
  }

  /** Whole-pixel render position and depth. */
  sync(): void {
    const px = Math.round(this.x);
    const py = Math.round(this.y);
    this.sprite.setPosition(px, py);
    this.sprite.setDepth(ysortDepth(py, this.bias));
    this.shadow.setPosition(px, py - 1);
    if (this.marker) this.marker.setPosition(px, py - this.manifest.characters.frame.h - 4);
  }

  play(walking: boolean): void {
    const key = `${this.sheet}:${walking ? 'walk' : 'idle'}-${this.dir}`;
    if (this.sprite.anims.currentAnim?.key !== key || !this.sprite.anims.isPlaying)
      this.sprite.anims.play(key, true);
  }

  setMarker(kind: MarkerKind): void {
    if (kind === this.markerKind) return;
    this.markerKind = kind;
    this.marker?.destroy();
    this.marker = undefined;
    if (kind === 'none') return;
    this.marker = this.scene.add
      .image(0, 0, `interior.mark.${kind === 'waiting' ? 'wait' : kind}`)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.fx);
    this.sync();
  }

  followPath(points: Vec[]): void {
    this.follower = points.length ? new PathFollower(points, WALK_SPEED, this.dir) : undefined;
  }

  get busy(): boolean {
    return !!this.follower;
  }

  /** Advance along the current path, if any. Returns true while walking. */
  stepPath(dt: number): boolean {
    if (!this.follower) {
      this.moving = false;
      this.play(false);
      return false;
    }
    const s = this.follower.step({ x: this.x, y: this.y }, dt);
    this.x = s.x;
    this.y = s.y;
    this.dir = s.dir;
    this.moving = !s.done;
    if (s.done) this.follower = undefined;
    this.play(this.moving);
    this.sync();
    return this.moving;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.marker?.destroy();
  }
}

export class PlayerActor extends Actor {
  constructor(scene: Phaser.Scene, manifest: Manifest, x: number, y: number) {
    super(scene, manifest, manifest.characters.player, x, y, SORT_BIAS.player);
  }
}

export class NpcActor extends Actor {
  /** Next idle wander time (ms of scene clock). */
  wanderAt = 0;
  wander = true;
  goalKey: string | undefined;
  /** Last directed goal, replanned when a door locks mid-route. */
  goal: { goal: import('../agents/director').Goal; wander: boolean } | undefined;
  constructor(
    scene: Phaser.Scene,
    manifest: Manifest,
    sheet: string,
    readonly id: string,
    x: number,
    y: number,
  ) {
    super(scene, manifest, sheet, x, y, SORT_BIAS.npc);
  }
}
