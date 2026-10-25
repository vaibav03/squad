export interface Animatable {
  x: number;
  y: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  visible?: boolean;
}
export interface Point {
  x: number;
  y: number;
}
export interface MotionHandle {
  readonly done: boolean;
  readonly finished: Promise<void>;
  cancel(): void;
  /** Jump to the end state and complete (loops: stop at rest state). */
  skip(): void;
}
export interface Revealable {
  setReveal(progress: number): void;
}
export interface Walker extends Animatable {
  setFrame?(frameIndex: number): void;
  setFacing?(dir: 'left' | 'right' | 'up' | 'down'): void;
}
export type BubbleTarget = Animatable;
export type EnvelopeTarget = Animatable;
export interface CameraLike {
  scrollX: number;
  scrollY: number;
}
