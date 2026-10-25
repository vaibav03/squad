import { MASTERY_PIPS, levelOf, masteryPips, masteryWord } from './model';
import './mastery.css';

/** Five pips. Lit pips are filled, unlit are hollow, so it reads without colour; the word always sits beside it. */
export function Pips({ box, label }: { box: number; label?: string }) {
  const r = masteryPips(box);
  return (
    <span
      className="lv-mp"
      data-level={levelOf(r)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: MASTERY_PIPS }, (_, i) => (
        <i key={i} data-on={i < r || undefined} />
      ))}
    </span>
  );
}

/** Pips plus the word, as one phrase for screen readers ("Getting there, 3 of 5 pips"). */
export function Level({ box, who }: { box: number; who?: string }) {
  const word = masteryWord(box);
  const n = masteryPips(box);
  return (
    <span className="lv-level" data-level={levelOf(n)}>
      <Pips box={box} label={`${who ? `${who}: ` : ''}${word}, ${n} of ${MASTERY_PIPS} pips`} />
      <span className="lv-level__word">{word}</span>
    </span>
  );
}
