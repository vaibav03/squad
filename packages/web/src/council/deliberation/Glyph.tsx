import { Icon } from '../../primitives/Icon';
import { ICON_NAMES, type IconName } from '../../primitives/icon-names';

/** Renders an icon by name (the council contracts carry Lucide icon names, never text glyphs). Unknown or empty -> nothing. */
export function Glyph({ name, size = 14 }: { name: string | undefined; size?: number }) {
  if (!name || !(ICON_NAMES as readonly string[]).includes(name)) return null;
  return <Icon name={name as IconName} size={size} />;
}
