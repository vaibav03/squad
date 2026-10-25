import { describe, expect, it } from 'vitest';
import { FRAME_MS, LabRunner } from './engine';
import { SCENES } from './scenes';

const snap = (r: LabRunner): string => JSON.stringify(r.stage.snapshot());

describe('scene registry', () => {
  it('has 21 scenes m1..m21 on rows 1..21 with unique ids', () => {
    expect(SCENES).toHaveLength(21);
    expect(SCENES.map((s) => s.id)).toEqual(Array.from({ length: 21 }, (_, i) => `m${i + 1}`));
    expect(SCENES.map((s) => s.row)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(21);
  });
  it('every scene has non-empty labels and a loop length', () => {
    for (const s of SCENES) {
      expect(s.reducedLabel.trim().length).toBeGreaterThan(0);
      expect(s.curveLabel.length).toBeGreaterThan(0);
      expect(s.durationLabel.length).toBeGreaterThan(0);
      expect(s.purpose.length).toBeGreaterThan(0);
      expect(s.loopMs).toBeGreaterThan(0);
    }
  });
  it('DOM rows are 16, 18, 19, 21; row 15 also has a DOM half', () => {
    expect(SCENES.filter((s) => s.kind === 'dom').map((s) => s.row)).toEqual([16, 18, 19, 21]);
    expect(SCENES.filter((s) => s.domDemo).map((s) => s.row)).toEqual([15, 16, 18, 19, 21]);
  });
  it('every scene builds and runs a full loop in both modes without throwing', () => {
    for (const reduced of [false, true]) {
      for (const s of SCENES) {
        const r = new LabRunner(s.id);
        r.setReduced(reduced);
        for (let t = 0; t < s.loopMs + 200; t += 50) r.tick(50);
        expect(r.stage.nodes.length >= 0).toBe(true);
      }
    }
  });
});

describe('LabRunner', () => {
  it('0.25x stretches progress 4x', () => {
    const a = new LabRunner('m3');
    const b = new LabRunner('m3');
    b.setSpeed(0.25);
    for (let i = 0; i < 20; i++) a.tick(100); // 2000 ms at 1x
    for (let i = 0; i < 80; i++) b.tick(100); // 8000 ms wall at 0.25x
    expect(b.sceneMs).toBeCloseTo(a.sceneMs, 6);
    expect(snap(b)).toBe(snap(a));
    const c = new LabRunner('m3');
    for (let i = 0; i < 20; i++) c.tick(100);
    const d = new LabRunner('m3');
    d.setSpeed(0.25);
    for (let i = 0; i < 20; i++) d.tick(100);
    expect(d.sceneMs).toBeCloseTo(c.sceneMs / 4, 6);
  });

  it('seekTo(50% of loop) twice yields identical stage state', () => {
    for (const s of SCENES) {
      const r = new LabRunner(s.id);
      r.seekPct(50);
      const first = snap(r);
      r.tick(130);
      r.seekPct(50);
      expect(snap(r)).toBe(first);
    }
  });

  it('seekTo lands on the requested frame', () => {
    const r = new LabRunner('m8');
    r.seekTo(50);
    expect(r.frame).toBe(50);
    expect(r.sceneMs).toBeCloseTo(50 * FRAME_MS, 6);
  });

  it('stepper advances exactly one 1/60 s frame and pauses', () => {
    const r = new LabRunner('m3');
    r.seekTo(10);
    const now = r.rt.now;
    r.stepFrame(1);
    expect(r.rt.now - now).toBeCloseTo(1000 / 60, 9);
    expect(r.frame).toBe(11);
    expect(r.isPlaying).toBe(false);
    r.stepFrame(-1);
    expect(r.frame).toBe(10);
    r.tick(500); // paused: no movement
    expect(r.frame).toBe(10);
  });

  it('loops by rebuilding once loopMs elapses; no-loop pauses at the end', () => {
    const r = new LabRunner('m9');
    for (let t = 0; t < r.scene.loopMs + 100; t += 50) r.tick(50);
    expect(r.sceneMs).toBeLessThan(200);
    expect(r.isPlaying).toBe(true);
    const n = new LabRunner('m9');
    n.setLoop(false);
    for (let t = 0; t < n.scene.loopMs + 100; t += 50) n.tick(50);
    expect(n.isPlaying).toBe(false);
  });

  it('strip has 5 entries and restores the position', () => {
    const r = new LabRunner('m12');
    r.seekTo(33);
    const out = r.strip((s) => JSON.stringify(s.snapshot()));
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBeGreaterThan(1);
    expect(r.frame).toBe(33);
  });

  it('select switches scene and restarts', () => {
    const r = new LabRunner('m1');
    r.tick(300);
    r.select('m5');
    expect(r.scene.row).toBe(5);
    expect(r.sceneMs).toBe(0);
  });
});

describe('reduced motion changes end states', () => {
  const endSnap = (id: string, reduced: boolean, ms: number): LabRunner => {
    const r = new LabRunner(id);
    r.setReduced(reduced);
    r.pause();
    r.seekTo(Math.round(ms / FRAME_MS));
    return r;
  };

  it('row 3 teleports: mid-walk the normal walker is between, reduced is already at the target', () => {
    const n = endSnap('m3', false, 1000).stage.find('walker')!;
    expect(n.x).toBeGreaterThan(24);
    expect(n.x).toBeLessThan(248);
    const r = endSnap('m3', true, 200).stage.find('walker')!;
    expect(r.x).toBe(248);
    // and no walk frames in reduced
    expect(r.frame).toBe(0);
  });

  it('row 9 is static: the reduced marker is at scale 1, alpha 1 from frame 0', () => {
    const r0 = new LabRunner('m9');
    r0.setReduced(true);
    const m = r0.stage.find('marker')!;
    expect([m.alpha, m.scaleX, m.scaleY]).toEqual([1, 1, 1]);
    const n = endSnap('m9', false, 0).stage.find('marker')!;
    expect(n.alpha).toBe(0);
    expect(n.scaleX).toBeLessThan(1);
  });

  it('row 10 shows the static waiting label and ring', () => {
    const r = endSnap('m10', true, 500);
    expect(r.stage.label).toBe('WAITING');
    const ring = r.stage.find('ring')!;
    expect([ring.alpha, ring.scaleX]).toEqual([0.6, 1]);
    expect(endSnap('m10', false, 500).stage.label).toBeNull();
  });

  it('row 8 bubble keeps scale 1 when reduced', () => {
    const r = endSnap('m8', true, 80);
    expect(r.stage.find('bubble')!.scaleX).toBe(1);
    expect(endSnap('m8', false, 80).stage.find('bubble')!.scaleX).toBeLessThan(1);
  });

  it('row 14 is a jump cut when reduced', () => {
    const r = endSnap('m14', true, 350);
    expect(r.stage.cam.scrollX).toBe(180);
    expect(endSnap('m14', false, 400).stage.cam.scrollX).toBeLessThan(180);
  });

  it('row 1 layers stop when reduced', () => {
    const r = endSnap('m1', true, 3000);
    expect(r.stage.find('far')!.tilePositionX).toBe(0);
    expect(r.stage.find('cloud')!.tilePositionX).toBe(0);
    expect(endSnap('m1', false, 3000).stage.find('near')!.tilePositionX).toBeGreaterThan(0);
  });

  it('row 2 snaps in 200 ms when reduced, still mid-lerp at 20 s scale otherwise', () => {
    expect(endSnap('m2', true, 400).stage.sky).toBe(0x0b1d38);
    expect(endSnap('m2', false, 400).stage.sky).not.toBe(0x0b1d38);
  });

  it('row 20 shows the static card when reduced', () => {
    const r = endSnap('m20', true, 400);
    expect(r.stage.find('card')!.alpha).toBe(1);
    expect(r.stage.find('trip')!.alpha).toBe(1);
    expect(r.stage.find('vehicle')!.x).toBe(20);
    expect(endSnap('m20', false, 400).stage.find('card')!.alpha).toBe(0);
  });

  it('every canvas scene reacts to the reduced toggle somewhere in its loop (or is documented the same)', () => {
    const changed: number[] = [];
    for (const s of SCENES.filter((x) => x.kind === 'canvas')) {
      const a = new LabRunner(s.id);
      const b = new LabRunner(s.id);
      b.setReduced(true);
      let diff = false;
      for (const pct of [0, 10, 25, 40, 50, 75, 90]) {
        a.seekPct(pct);
        b.seekPct(pct);
        if (snap(a) !== snap(b)) diff = true;
      }
      if (diff) changed.push(s.row);
    }
    // rows with a real reduced branch in the table
    for (const row of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 20]) {
      expect(changed).toContain(row);
    }
  });
});
