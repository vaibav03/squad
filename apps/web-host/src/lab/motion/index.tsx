import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import '../../../../../packages/web/src/motion/motion.css';
import './lab.css';
import { LabRunner, STRIP_PCTS, FRAME_MS } from './engine';
import { renderStage } from './renderer';
import { SCENES, type DomDemo, type LabScene } from './scenes';

declare global {
  interface Window {
    __motionLab?: {
      ids: string[];
      select(id: string): void;
      seek(pct: number): void;
      setSpeed(n: number): void;
      setReduced(b: boolean): void;
      strip(id: string): string[];
    };
  }
}

/** Render a runner's stage to a data URL at 1x (used by the frame strip and Playwright). */
function capture(runner: LabRunner): string {
  const c = document.createElement('canvas');
  c.width = runner.stage.w;
  c.height = runner.stage.h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  renderStage(ctx, runner.stage, 1);
  return c.toDataURL('image/png');
}

function stripFor(id: string, reduced: boolean): string[] {
  const r = new LabRunner(id);
  r.setReduced(reduced);
  if (r.scene.kind === 'dom') return STRIP_PCTS.map(() => '');
  return r.strip(() => capture(r));
}

function DomStage({ demo, on, speed }: { demo: DomDemo; on: boolean; speed: number }) {
  // Real CSS from motion.css; 0.25x stretches its duration variables 4x.
  const k = 1 / speed;
  const vars = {
    '--m-dur-panel': `${240 * k}ms`,
    '--m-dur-press': `${100 * k}ms`,
    '--m-dur-chip': `${150 * k}ms`,
    '--m-dur-fade': `${200 * k}ms`,
    '--m-dur-check': `${200 * k}ms`,
  } as CSSProperties;
  const state = on ? 'open' : 'closed';
  return (
    <div className="ml-dom" style={vars} data-testid={`dom-${demo}`}>
      {demo === 'panel' && (
        <div className="m-panel ml-dom-box" data-state={state}>
          <b>Call panel</b>
          <span>Slides in 8 px with opacity, exit mirrors entry.</span>
        </div>
      )}
      {demo === 'fade' && (
        <div className="m-fade ml-dom-box" data-state={state}>
          <b>Inside the building</b>
          <span>.m-fade, 200 ms ease-out (120 ms reduced).</span>
        </div>
      )}
      {demo === 'chip' && (
        <span
          className="m-chip ml-chip"
          style={{
            color: on ? 'var(--state-studying)' : 'var(--state-idle)',
            opacity: on ? 1 : 0.7,
          }}
        >
          Ana: {on ? 'studying' : 'idle'}
        </span>
      )}
      {demo === 'press' && (
        <button type="button" className="m-press ml-btn">
          Press and hold me
        </button>
      )}
      {demo === 'badge' && (
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <span
            className="m-badge ml-badge"
            style={{ opacity: on ? 1 : 0.25, color: 'var(--success)' }}
          >
            LIVE
          </span>
          <span
            className="m-badge ml-badge"
            style={{ opacity: on ? 0.25 : 1, color: 'var(--info)' }}
          >
            REPLAY
          </span>
        </div>
      )}
    </div>
  );
}

export default function MotionLab() {
  const runnerRef = useRef<LabRunner | null>(null);
  if (runnerRef.current === null) runnerRef.current = new LabRunner();
  const runner = runnerRef.current;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageBox = useRef<HTMLDivElement | null>(null);
  const [, force] = useState(0);
  const [strip, setStrip] = useState<string[]>([]);
  const [boxW, setBoxW] = useState(320);
  const [domOn, setDomOn] = useState(false);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const scene: LabScene = runner.scene;
  const scale = Math.max(1, Math.min(4, Math.floor(boxW / runner.stage.w)));

  const refreshStrip = useCallback(() => {
    setStrip(stripFor(runner.scene.id, runner.reduced));
  }, [runner]);

  // Calm/reduced attribute for the DOM half (motion.css reads data-calm on <html>).
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute('data-calm');
    if (runner.reduced) el.setAttribute('data-calm', 'true');
    else el.removeAttribute('data-calm');
    return () => {
      if (prev === null) el.removeAttribute('data-calm');
      else el.setAttribute('data-calm', prev);
    };
  });

  // Size observer for the integer pixel scale.
  useEffect(() => {
    const el = stageBox.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth - 18));
    ro.observe(el);
    setBoxW(el.clientWidth - 18);
    return () => ro.disconnect();
  }, []);

  // rAF loop: tick + draw. State is re-read for the counters each frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = now - last;
      last = now;
      runner.tick(dt);
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) renderStage(ctx, runner.stage, scale);
      rerender();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runner, scale, rerender]);

  // DOM demos auto-toggle on loop while playing.
  useEffect(() => {
    if (scene.kind !== 'dom' && !scene.domDemo) return;
    if (!runner.isPlaying || !runner.loop) return;
    const id = window.setInterval(() => setDomOn((v) => !v), scene.loopMs / 2 / runner.timeScale);
    return () => window.clearInterval(id);
  });

  useEffect(() => {
    refreshStrip();
  }, [scene.id, runner.reduced, refreshStrip]);

  const act = useCallback(
    (fn: () => void) => {
      fn();
      rerender();
    },
    [rerender],
  );

  // Playwright hook.
  useEffect(() => {
    window.__motionLab = {
      ids: runner.ids,
      select: (id) => act(() => runner.select(id)),
      seek: (pct) =>
        act(() => {
          runner.pause();
          runner.seekPct(pct);
        }),
      setSpeed: (n) => act(() => runner.setSpeed(n)),
      setReduced: (b) => act(() => runner.setReduced(b)),
      strip: (id) => stripFor(id, runner.reduced),
    };
    return () => {
      delete window.__motionLab;
    };
  }, [runner, act]);

  // Keyboard: space play/pause, arrows step, 1/2 speed, R reduced.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))
        return;
      if (e.key === ' ' && t?.tagName !== 'BUTTON') {
        e.preventDefault();
        act(() => runner.toggle());
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        act(() => runner.stepFrame(1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        act(() => runner.stepFrame(-1));
      } else if (e.key === '1') act(() => runner.setSpeed(1));
      else if (e.key === '2') act(() => runner.setSpeed(0.25));
      else if (e.key === 'r' || e.key === 'R') act(() => runner.setReduced(!runner.reduced));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runner, act]);

  const isDomOnly = scene.kind === 'dom';
  const hasDom = !!scene.domDemo;
  const frameInfo = useMemo(
    () =>
      `frame ${runner.frame} / ${runner.lastFrame}   ${runner.sceneMs.toFixed(0)} ms / ${scene.loopMs} ms`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runner.frame, scene.loopMs, runner.sceneMs],
  );

  return (
    <div className="ml">
      <nav className="ml-side" aria-label="Scenes">
        <h1 className="ml-title">Motion Lab</h1>
        <ul className="ml-list">
          {SCENES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="ml-item"
                aria-current={s.id === scene.id}
                data-testid={`scene-${s.id}`}
                onClick={() => act(() => runner.select(s.id))}
              >
                <span className="ml-row">{s.row}</span>
                <span>{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="ml-main">
        <select
          className="ml-select"
          aria-label="Scene"
          value={scene.id}
          onChange={(e) => act(() => runner.select(e.target.value))}
        >
          {SCENES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.row}. {s.title}
            </option>
          ))}
        </select>

        <section>
          <h2>
            {scene.row}. {scene.title}
          </h2>
          <div className="ml-info">
            <span>{scene.purpose}</span>
            <span>
              <b>Curve</b> {scene.curveLabel}
            </span>
            <span>
              <b>Time</b> {scene.durationLabel} (
              {scene.kind === 'dom' ? 'DOM' : hasDom ? 'canvas plus DOM' : 'canvas'})
            </span>
            <span>
              <b>Reduced</b> {scene.reducedLabel}
            </span>
          </div>
        </section>

        <div className="ml-stage" ref={stageBox}>
          {!isDomOnly && (
            <canvas
              ref={canvasRef}
              className="ml-canvas"
              width={runner.stage.w * scale}
              height={runner.stage.h * scale}
              aria-label={`${scene.title} animation`}
              data-testid="stage"
            />
          )}
          {hasDom && (
            <DomStage demo={scene.domDemo as DomDemo} on={domOn} speed={runner.timeScale} />
          )}
        </div>

        <div className="ml-controls" role="group" aria-label="Playback">
          <button
            type="button"
            className="ml-btn"
            onClick={() => act(() => runner.toggle())}
            aria-pressed={!runner.isPlaying}
          >
            {runner.isPlaying ? 'Pause' : 'Play'}
          </button>
          <div className="ml-seg" role="radiogroup" aria-label="Speed">
            {[1, 0.25].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={runner.timeScale === n}
                className="ml-btn"
                onClick={() => act(() => runner.setSpeed(n))}
              >
                {n}x
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={runner.reduced}
            className="ml-btn"
            onClick={() => act(() => runner.setReduced(!runner.reduced))}
          >
            Reduced motion
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={runner.loop}
            className="ml-btn"
            onClick={() => act(() => runner.setLoop(!runner.loop))}
          >
            Loop
          </button>
          {hasDom && (
            <button
              type="button"
              className="ml-btn"
              onClick={() => setDomOn((v) => !v)}
              data-testid="dom-toggle"
            >
              Toggle data-state
            </button>
          )}
        </div>

        {!isDomOnly && (
          <div className="ml-controls" role="group" aria-label="Frame stepper">
            <button
              type="button"
              className="ml-btn"
              aria-label="Step back one frame"
              onClick={() => act(() => runner.stepFrame(-1))}
            >
              -1f
            </button>
            <input
              className="ml-scrub"
              type="range"
              min={0}
              max={runner.lastFrame}
              step={1}
              value={Math.min(runner.frame, runner.lastFrame)}
              aria-label="Scrub"
              onChange={(e) =>
                act(() => {
                  runner.pause();
                  runner.seekTo(Number(e.target.value));
                })
              }
            />
            <button
              type="button"
              className="ml-btn"
              aria-label="Step forward one frame"
              onClick={() => act(() => runner.stepFrame(1))}
            >
              +1f
            </button>
            <span className="ml-readout" data-testid="readout">
              {frameInfo} ({FRAME_MS.toFixed(2)} ms/frame)
            </span>
          </div>
        )}

        {!isDomOnly && (
          <div className="ml-strip" aria-label="Frame strip">
            {STRIP_PCTS.map((p, i) => (
              <figure key={p}>
                {strip[i] ? (
                  <img src={strip[i]} alt={`${scene.title} at ${p}%`} />
                ) : (
                  <div className="ml-empty" />
                )}
                <figcaption>{p}%</figcaption>
              </figure>
            ))}
          </div>
        )}
        <p className="ml-readout">Keys: space play/pause, arrows step, 1 / 2 speed, R reduced.</p>
      </main>
    </div>
  );
}
