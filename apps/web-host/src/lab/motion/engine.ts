import { MotionRuntime, createMotionPrefs, type MotionPrefsStore } from './prims';
import { SCENES, getScene, type LabScene } from './scenes';
import { Stage } from './stage';

/** One display frame at 60 fps, in ms. The stepper advances exactly this much. */
export const FRAME_MS = 1000 / 60;
export const STRIP_PCTS = [0, 25, 50, 75, 100] as const;

/**
 * Owns a MotionRuntime (own prefs store, no storage, no media query), the active scene's Stage,
 * speed, play/pause, looping, the exact frame stepper and deterministic seeking.
 * Pure and framework free: the page only calls tick() from rAF and renders runner.stage.
 */
export class LabRunner {
  readonly prefs: MotionPrefsStore = createMotionPrefs({ storage: null, matchMedia: null });
  /** Fresh runtime per rebuild (time starts at exactly 0), sharing this runner's prefs store. */
  rt: MotionRuntime;
  scenes: LabScene[] = SCENES;
  scene: LabScene;
  stage: Stage = new Stage();
  loop = true;
  private playing = true;
  private speed = 1;

  constructor(sceneId: string = SCENES[0]!.id) {
    this.rt = new MotionRuntime({ prefs: this.prefs });
    this.scene = getScene(sceneId);
    this.rebuild();
  }

  get ids(): string[] {
    return this.scenes.map((s) => s.id);
  }
  get reduced(): boolean {
    return this.prefs.effectiveReduced;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get timeScale(): number {
    return this.speed;
  }
  /** Scene-time elapsed since the last rebuild, ms (already scaled by speed). */
  get sceneMs(): number {
    return this.rt.now;
  }
  get frame(): number {
    return Math.floor(this.sceneMs / FRAME_MS + 1e-6);
  }
  get lastFrame(): number {
    return Math.floor(this.scene.loopMs / FRAME_MS + 1e-6);
  }
  /** 0..1 position inside one loop. */
  get progress(): number {
    return Math.min(1, this.sceneMs / this.scene.loopMs);
  }

  /** Fresh stage, runtime cleared, primitives restarted from frame 0. */
  rebuild(): void {
    this.rt.cancelAll();
    this.rt = new MotionRuntime({ prefs: this.prefs });
    this.rt.timeScale = this.speed;
    this.rt.paused = !this.playing;
    this.stage = new Stage();
    this.scene.build(this.rt, this.stage);
    // Sequencers (cutscene) start their first step on the first pass; run a zero-dt pass.
    this.rt.step(0);
  }

  select(id: string): void {
    this.scene = getScene(id);
    this.rebuild();
  }

  setSpeed(n: number): void {
    this.speed = n;
    this.rt.timeScale = n;
  }

  /** Reduced toggle drives the reduced override AND Calm, then restarts the scene. */
  setReduced(on: boolean): void {
    this.prefs.setReducedOverride(on);
    this.prefs.setCalm(on);
    this.rebuild();
  }

  setLoop(on: boolean): void {
    this.loop = on;
  }

  play(): void {
    if (!this.loop && this.sceneMs >= this.scene.loopMs) this.rebuild();
    this.playing = true;
    this.rt.paused = false;
  }
  pause(): void {
    this.playing = false;
    this.rt.paused = true;
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Advance by a wall-clock delta (rAF). Honours speed, pause and looping. */
  tick(wallDeltaMs: number): void {
    if (!this.playing) return;
    this.rt.update(wallDeltaMs);
    this.afterAdvance();
  }

  private afterAdvance(): void {
    if (this.sceneMs < this.scene.loopMs) return;
    if (this.loop) this.rebuild();
    else {
      this.playing = false;
      this.rt.paused = true;
    }
  }

  /** Exactly one 1/60 s frame forward (1) or back (-1). Pauses. Back is a deterministic seek. */
  stepFrame(dir: 1 | -1): void {
    this.pause();
    if (dir < 0) {
      this.seekTo(Math.max(0, this.frame - 1));
      return;
    }
    if (this.frame >= this.lastFrame) {
      if (this.loop) this.seekTo(0);
      return;
    }
    this.rt.step(FRAME_MS);
  }

  /** Rebuild and run N exact frames. Same N always gives the same stage state. */
  seekTo(frame: number): void {
    const n = Math.max(0, Math.min(this.lastFrame, Math.round(frame)));
    this.rebuild();
    for (let i = 0; i < n; i++) this.rt.step(FRAME_MS);
  }

  /** Seek to a percentage (0..100) of the loop. */
  seekPct(pct: number): void {
    this.seekTo((Math.max(0, Math.min(100, pct)) / 100) * this.lastFrame);
  }

  /** Capture the stage at 0/25/50/75/100% of one loop, then restore the current position. */
  strip<T>(capture: (stage: Stage) => T): T[] {
    const keep = this.frame;
    const out = STRIP_PCTS.map((p) => {
      this.seekPct(p);
      return capture(this.stage);
    });
    this.seekTo(keep);
    return out;
  }
}
