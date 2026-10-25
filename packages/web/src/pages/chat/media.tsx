import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment } from '@squad/core';
import { Icon } from '../../primitives/Icon';
import { Sheet } from '../../primitives/Sheet';
import { formatBytes, formatDuration } from './model';

/** Image attachment: a quiet thumbnail; click opens a lightbox sheet. */
export function ImageAttachment({
  att,
  url,
  scene,
  label,
}: {
  att: ChatAttachment;
  url: string;
  scene?: boolean;
  /** what the message says it is ("Picture from Squad"); falls back to the file name */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const alt = label ?? (att.name ? `Image: ${att.name}` : 'Image attachment');
  if (state === 'error')
    return (
      <div className="sqc-media sqc-media--broken" role="img" aria-label="Image unavailable">
        <Icon name="image" size={18} />
        <span>Image unavailable</span>
      </div>
    );
  return (
    <>
      <button
        type="button"
        className="sqc-media sqc-media--img"
        data-state={state}
        onClick={() => setOpen(true)}
        aria-label={`${alt}. Open larger`}
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={att.name ?? 'Image'}
        side="center"
        scene={scene}
      >
        <img className="sqc-lightbox" src={url} alt={alt} />
      </Sheet>
    </>
  );
}

const hash = (s: string) => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
/** Static waveform heights (percent), stable per attachment id. */
export function waveformBars(id: string, n = 32): number[] {
  let h = hash(id);
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.55 + (h % 7)));
    return Math.round(30 + 70 * base * (0.6 + (0.4 * ((h >>> 8) % 100)) / 100));
  });
}

/** Accessible custom audio player: play/pause, scrub (also a real range input), elapsed and total time. */
export function AudioPlayer({
  att,
  url,
  label,
}: {
  att: ChatAttachment;
  url: string;
  label?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [error, setError] = useState(false);
  const bars = useMemo(() => waveformBars(att.id), [att.id]);
  useEffect(() => () => ref.current?.pause(), []);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setError(true));
    else a.pause();
  };
  const pct = dur > 0 ? Math.min(1, t / dur) : 0;
  const title = label ?? att.name ?? 'Audio';
  return (
    <div className="sqc-audio" role="group" aria-label={`Audio: ${title}`}>
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setT(0);
        }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) =>
          setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
        }
        onError={() => setError(true)}
      />
      <button
        type="button"
        className="sqc-audio__play"
        onClick={toggle}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
        disabled={error}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div className="sqc-audio__main">
        <div className="sqc-audio__wave" style={{ ['--p' as string]: pct }}>
          {bars.map((h, i) => (
            <i
              key={i}
              style={{ height: `${h}%` }}
              data-on={(i + 0.5) / bars.length <= pct || undefined}
            />
          ))}
          <input
            type="range"
            className="sqc-audio__seek"
            min={0}
            max={dur || 1}
            step={0.1}
            value={t}
            disabled={!dur || error}
            aria-label="Seek"
            aria-valuetext={`${formatDuration(t)} of ${formatDuration(dur)}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (ref.current) ref.current.currentTime = v;
              setT(v);
            }}
          />
        </div>
        <div className="sqc-audio__meta">
          <span>{error ? 'Audio unavailable' : title}</span>
          <span className="sqc-audio__time">
            {formatDuration(t)} / {formatDuration(dur)}
            {att.bytes ? ` · ${formatBytes(att.bytes)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
