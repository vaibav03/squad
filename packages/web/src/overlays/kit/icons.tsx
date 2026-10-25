import type { SVGProps } from 'react';
import {
  Check,
  X,
  Mic,
  MicOff,
  Hand,
  PhoneOff,
  Lock,
  Eye,
  EyeOff,
  FileText,
  TriangleAlert,
  WifiOff,
  Info,
  Users,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Pin,
  Shield,
  Sparkles,
  Split,
  Plane,
  Vote,
  Clock,
  LayoutGrid,
  Radio,
  Loader,
  CircleX,
  CircleCheck,
  CircleDashed,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  PencilLine,
  Wifi,
  History,
  type LucideIcon,
} from 'lucide-react';

/** Overlay icons. One family only: these are Lucide (ISC, docs/CREDITS.md), same as the `Icon` primitive. */
const ICONS = {
  check: Check,
  x: X,
  mic: Mic,
  'mic-off': MicOff,
  hand: Hand,
  'phone-off': PhoneOff,
  lock: Lock,
  eye: Eye,
  'eye-off': EyeOff,
  file: FileText,
  alert: TriangleAlert,
  'wifi-off': WifiOff,
  info: Info,
  users: Users,
  chevron: ChevronRight,
  'chevron-down': ChevronDown,
  refresh: RefreshCw,
  pin: Pin,
  shield: Shield,
  sparkle: Sparkles,
  split: Split,
  plane: Plane,
  vote: Vote,
  clock: Clock,
  grid: LayoutGrid,
  radio: Radio,
  loader: Loader,
  'circle-x': CircleX,
  'circle-check': CircleCheck,
  'circle-dashed': CircleDashed,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'arrow-left-right': ArrowLeftRight,
  pencil: PencilLine,
  wifi: Wifi,
  history: History,
} as const satisfies Record<string, LucideIcon>;

export type LvIconName = keyof typeof ICONS;

export function LvIcon({
  name,
  size = 20,
  ...rest
}: { name: LvIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name' | 'ref'>) {
  const Cmp = ICONS[name];
  return (
    <Cmp
      width={size}
      height={size}
      strokeWidth={2}
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  );
}
