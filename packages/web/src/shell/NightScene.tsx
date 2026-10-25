import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import sky from '../../../../assets/pixel/composed/backgrounds/0_sky.png';
import stars from '../../../../assets/pixel/composed/backgrounds/1_stars.png';
import moon from '../../../../assets/pixel/composed/backgrounds/2_moon.png';
import cloudsFar from '../../../../assets/pixel/composed/backgrounds/3_clouds_far.png';
import cloudsNear from '../../../../assets/pixel/composed/backgrounds/4_clouds_near.png';
import hillsFar from '../../../../assets/pixel/composed/backgrounds/5_hills_far.png';
import hillsMid from '../../../../assets/pixel/composed/backgrounds/6_hills_mid.png';
import hillsNear from '../../../../assets/pixel/composed/backgrounds/7_hills_near.png';
import fence from '../../../../assets/pixel/composed/backgrounds/8_fenceline.png';
import ground from '../../../../assets/pixel/composed/backgrounds/9_ground.png';
import './night-scene.css';

export interface NightSceneProps {
  /** Fixed integer pixel scale. Default: computed from the container height so the 270px-tall art covers it. */
  scale?: number;
  /** 0..1: how much of the 270px-tall art to show from the bottom (crops the sky). Default 1. */
  className?: string;
  children?: ReactNode;
}

/** The parallax night backdrop (static, integer-scaled, pixelated). Decorative only. */
export function NightScene({ scale, className, children }: NightSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(scale ?? 2);
  useEffect(() => {
    if (scale || !ref.current || typeof ResizeObserver === 'undefined') return;
    const el = ref.current;
    const fit = () => setK(Math.max(1, Math.min(4, Math.ceil(el.clientHeight / 270))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale]);
  const layer = (src: string, extra?: CSSProperties) => (
    <i
      className="sq-night__layer"
      aria-hidden="true"
      style={{ backgroundImage: `url(${src})`, ...extra }}
    />
  );
  return (
    <div
      ref={ref}
      className={['sq-night', className].filter(Boolean).join(' ')}
      style={{ ['--k' as string]: k }}
    >
      <i
        className="sq-night__layer sq-night__sky"
        aria-hidden="true"
        style={{ backgroundImage: `url(${sky})` }}
      />
      {layer(stars)}
      <i
        className="sq-night__moon"
        aria-hidden="true"
        style={{ backgroundImage: `url(${moon})` }}
      />
      {layer(cloudsFar)}
      {layer(cloudsNear)}
      {layer(hillsFar)}
      {layer(hillsMid)}
      {layer(hillsNear)}
      {layer(fence)}
      {layer(ground, {
        height: 'calc(30px * var(--k))',
        backgroundSize: 'calc(480px * var(--k)) calc(30px * var(--k))',
        top: 'auto',
      })}
      {children}
    </div>
  );
}
