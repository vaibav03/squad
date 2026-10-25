import './skeleton.css';

export interface SkeletonProps {
  shape?: 'line' | 'block' | 'circle';
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function Skeleton({ shape = 'line', width, height, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={['sq-skeleton', `sq-skeleton--${shape}`, className].filter(Boolean).join(' ')}
      style={{ width, height }}
    />
  );
}
