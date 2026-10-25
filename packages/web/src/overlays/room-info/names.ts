import { looksLikeHash, studentLabel } from '@squad/village/inspector';
/** Speaker display names and colour tones for the room transcript. Tone is decoration only: the name is always shown. */
export type SpeakerTone = 'chill' | 'grind' | 'advisor' | 'chair' | 'agent' | 'you';

const NAMES: Readonly<Record<string, string>> = {
  chill: 'Chill',
  grind: 'Grind',
  advisor: 'Advisor',
  chair: 'Chair',
  dean: 'Dean',
  quiz: 'Quiz',
  'expert:oral': 'Oral Examiner',
  'expert:feynman': 'Feynman Buddy',
  'expert:panic': 'Calm Coach',
  'expert:rubric': 'Rubric Reader',
  'expert:oracle': 'Exam Oracle',
  'expert:devil': "Devil's TA",
  'ta:devil': "Devil's TA",
  devils: "Devil's TA",
};

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** 'chill' -> 'Chill', 'expert:oral' -> 'Oral Examiner', 'expert:ch5' -> 'Ch5 Expert', unknown 'foo_bar' -> 'Foo bar'. */
export function speakerName(id: string): string {
  const key = id.trim();
  const known = NAMES[key.toLowerCase()];
  if (known) return known;
  const m = /^expert:(.+)$/i.exec(key);
  if (m) return `${cap(m[1]!.replace(/[-_]+/g, ' '))} Expert`;
  const st = /^(?:student:)?([us]_.+)$/i.exec(key);
  if (st) return studentLabel(st[1]!);
  const bare = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  if (looksLikeHash(bare)) return studentLabel(bare);
  return cap(bare.replace(/[-_]+/g, ' ')) || 'Someone';
}

export function speakerTone(id: string): SpeakerTone {
  const k =
    id
      .trim()
      .toLowerCase()
      .split(/[\s(:]/)[0] ?? '';
  if (k === 'chill' || k === 'grind' || k === 'advisor' || k === 'chair') return k;
  if (k === 'you') return 'you';
  return 'agent';
}
