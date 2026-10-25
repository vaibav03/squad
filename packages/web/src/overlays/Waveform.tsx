import { useEffect, useRef } from 'react';
import './Waveform.css';

const BARS = 32;

/** Deterministic 0..1 per bar (no Math.random: stable tests and replays). */
export function barSeed(i: number): number {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export interface WaveformProps {
  /** 0..1 smoothed amplitude. Undefined = calm static baseline. */
  level?: number;
  tone: 'agent' | 'you' | 'idle';
  /** Reduced motion / Calm: bars hold a static shape that only reflects `level` once per render. */
  reduced?: boolean;
}

/** CSS bars scaled with transform only. The rAF loop pauses when the tab is hidden and when reduced. */
export function Waveform({ level, tone, reduced }: WaveformProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const apply = (t: number) => {
      const lv = levelRef.current;
      bars.forEach((b, i) => {
        let s = 0.12;
        if (lv !== undefined) {
          const wob = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(t / 180 + i * 0.9 + barSeed(i) * 6);
          // envelope: louder in the middle bars, like a voice spectrum
          const env = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / BARS);
          s = 0.12 + Math.min(1, Math.max(0, lv)) * env * (0.35 + 0.65 * wob) * 0.88;
        }
        b.style.transform = `scaleY(${s.toFixed(3)})`;
      });
    };
    apply(0);
    if (reduced || level === undefined) return;
    let raf = 0;
    const loop = (t: number) => {
      apply(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    if (!document.hidden) start();
    return () => {
      document.removeEventListener('visibilitychange', vis);
      stop();
    };
  }, [reduced, level === undefined, level]);

  return (
    <div ref={root} className="lv-wave" data-tone={tone} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} className="lv-wave__bar" />
      ))}
    </div>
  );
}
