import { modeInfo } from '@squad/village/council';
import { Glyph } from '../deliberation/Glyph';
import './mode-badge.css';

/**
 * Honest mode badge for every council surface: an icon AND a word (Live | Degraded: reason | Fixture). `mode` is the
 * event `mode` field; anything missing or unknown reads as Fixture, so scripted output can never look live.
 */
export function ModeBadge({
  mode,
  compact,
  className,
}: {
  mode: string | undefined | null;
  /** Short word only ('Degraded' without the reason); the reason stays in the title. */
  compact?: boolean;
  className?: string;
}) {
  const m = modeInfo(mode);
  return (
    <span
      className={['cb-mode', className].filter(Boolean).join(' ')}
      data-mode={m.tier}
      title={m.detail}
    >
      <span className="cb-mode__glyph" aria-hidden="true">
        <Glyph name={m.glyph} size={12} />
      </span>
      <span className="cb-mode__word">{compact ? m.short : m.word}</span>
    </span>
  );
}
