import type { LucideIcon } from 'lucide-react';
import {
  Check, X, Plus, Play, Pause, Volume2, Mic, VolumeX, Phone, CalendarDays, FileText, Lock, Eye,
  EyeOff, ChevronRight, ChevronLeft, ArrowRight, Upload, Info, TriangleAlert, Sparkles, Trash2,
  Link2, House, Map as MapIcon, BookOpen, Users, Plane, ScrollText, User, Sun, Moon, Menu,
} from 'lucide-react';
import type { IconName } from './icon-names';

const MAP: Record<IconName, LucideIcon> = {
  check: Check, x: X, plus: Plus, play: Play, pause: Pause, volume: Volume2, mic: Mic, mute: VolumeX,
  phone: Phone, calendar: CalendarDays, file: FileText, lock: Lock, eye: Eye, 'eye-off': EyeOff,
  'chevron-right': ChevronRight, 'chevron-left': ChevronLeft, 'arrow-right': ArrowRight, upload: Upload,
  info: Info, alert: TriangleAlert, sparkle: Sparkles, trash: Trash2, link: Link2, home: House,
  map: MapIcon, book: BookOpen, users: Users, plane: Plane, ledger: ScrollText, user: User, sun: Sun,
  moon: Moon, menu: Menu,
};

export interface IconProps {
  name: IconName;
  size?: number;
  /** Provide a title only when the icon carries meaning on its own. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 20, title, className }: IconProps) {
  const Cmp = MAP[name];
  return (
    <Cmp
      width={size}
      height={size}
      strokeWidth={2}
      absoluteStrokeWidth
      className={className ? `sq-icon ${className}` : 'sq-icon'}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable={false}
    />
  );
}
