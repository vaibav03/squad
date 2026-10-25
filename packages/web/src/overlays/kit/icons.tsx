import type { SVGProps } from 'react';

/** Small 2px-stroke line icons (24 grid, currentColor). Local to web-live so overlays need no shell. */
const P: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  'mic-off':
    'M4 4l16 16M9 9v3a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3M5.5 11a6.5 6.5 0 0 0 10.3 5.3M12 17.5V21',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-3 0-4.5-1.7-6-4.5l-1.2-2.3a1.4 1.4 0 0 1 2.3-1.5L8 14',
  'phone-off': 'M3 15.5c3-3 6-4 9-4s6 1 9 4l-2 2.5-3-1.5v-2.5a11 11 0 0 0-8 0V16.5L5 18z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  'eye-off':
    'M4 4l16 16M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8M6.2 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.8M10 10a2.5 2.5 0 0 0 3.5 3.5',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h5M9.5 15.5h5',
  alert: 'M12 4l9 16H3zM12 10v4.5M12 17.2v.3',
  'wifi-off':
    'M4 4l16 16M2.5 9.5a14 14 0 0 1 4.6-2.7M9.5 5.2c3.7-.4 7.4.9 10 3.4M5.5 13a9 9 0 0 1 3.4-2M13 10.3a9 9 0 0 1 5.5 2.7M9 16.5a4.5 4.5 0 0 1 5.5-.5M12 20v.2',
  info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5M12 7.8v.3',
  users:
    'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.3a3 3 0 0 1 0 5.4M18 14.8c1.9.7 3 2.3 3 4.7',
  chevron: 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  refresh: 'M4.5 12a7.5 7.5 0 0 1 13-5l2 2M19.5 4v5h-5M19.5 12a7.5 7.5 0 0 1-13 5l-2-2M4.5 20v-5h5',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  shield: 'M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z',
  sparkle:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  split: 'M4 12h6M10 12l8-6M10 12l8 6M18 6v0M18 18v0',
  plane: 'M10 14l-6.5-2.5L5 10l8 .5L18 5.5a1.7 1.7 0 0 1 2.5 2.5L15.5 13l.5 8-1.5 1.5L12 16z',
  vote: 'M5 12l3-7h8l3 7v7H5zM5 12h4l1 2h4l1-2h4',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export type LvIconName = keyof typeof P;

export function LvIcon({
  name,
  size = 20,
  ...rest
}: { name: LvIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  );
}
