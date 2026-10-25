import './spinner.css';

export interface SpinnerProps {
  size?: number;
  label?: string;
  className?: string;
}

/** Three pixel-style dots stepping in sequence (not a rotating ring). Static under reduced motion. */
export function Spinner({ size = 14, label = 'Loading', className }: SpinnerProps) {
  return (
    <span
      className={className ? `sq-spinner ${className}` : 'sq-spinner'}
      role="status"
      style={{ ['--sq-spinner-size' as string]: `${size}px` }}
    >
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <span className="sq-sr-only">{label}</span>
    </span>
  );
}
