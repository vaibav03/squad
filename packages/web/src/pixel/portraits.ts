// Pixel portraits from the design-foundation cast (32x32, opaque tiles). Imported as modules so Vite fingerprints them.
// Show at an integer scale (2x/3x/4x) with image-rendering: pixelated.
import student from '../../../../assets/pixel/composed/characters/student/portrait.png';
import dean from '../../../../assets/pixel/composed/characters/dean/portrait.png';
import examiner from '../../../../assets/pixel/composed/characters/examiner/portrait.png';
import expert from '../../../../assets/pixel/composed/characters/expert/portrait.png';
import freshman from '../../../../assets/pixel/composed/characters/freshman/portrait.png';
import mediator from '../../../../assets/pixel/composed/characters/mediator/portrait.png';
import ta from '../../../../assets/pixel/composed/characters/ta/portrait.png';
import chairman from '../../../../assets/pixel/composed/characters/chairman/portrait.png';
import councilBalance from '../../../../assets/pixel/composed/characters/council-balance/portrait.png';
import councilChill from '../../../../assets/pixel/composed/characters/council-chill/portrait.png';
import councilHard from '../../../../assets/pixel/composed/characters/council-hard/portrait.png';

export const PIXEL_PORTRAITS: Record<string, string> = {
  student: student,
  dean: dean,
  examiner: examiner,
  expert: expert,
  freshman: freshman,
  mediator: mediator,
  ta: ta,
  chairman: chairman,
  'council-balance': councilBalance,
  'council-chill': councilChill,
  'council-hard': councilHard,
};

export interface PixelCastMember {
  id: string;
  label: string;
  role: string;
}

/** The whole cast, in picker order, with accessible labels. */
export const PIXEL_CAST: readonly PixelCastMember[] = [
  { id: 'freshman', label: 'Freshman', role: 'Bright-eyed first-year, always asking' },
  { id: 'student', label: 'Student', role: 'You, in the red hood' },
  { id: 'ta', label: 'Teaching assistant', role: 'Cap, satchel and spare pens' },
  { id: 'expert', label: 'Chapter expert', role: 'Knows one chapter by heart' },
  { id: 'chairman', label: 'Chairman', role: 'The wizard who runs the council' },
  { id: 'examiner', label: 'Examiner', role: 'Badge, hat and a stern look' },
  { id: 'dean', label: 'Dean', role: 'Glasses, gray hair, knows everyone' },
  { id: 'mediator', label: 'Mediator', role: 'Keeps debates fair' },
  { id: 'council-balance', label: 'Council, balanced', role: 'Weighs both sides' },
  { id: 'council-chill', label: 'Council, chill', role: 'Calm and easygoing' },
  { id: 'council-hard', label: 'Council, hard', role: 'Strict and exact' },
];

/** Persona / hub agent ids and legacy avatar ids mapped onto the cast. */
const ALIASES: Record<string, string> = {
  buddy: 'freshman',
  cubbie: 'freshman',
  rival: 'ta',
  council: 'council-balance',
  'expert-ada': 'expert',
  'expert-sage': 'chairman',
  'expert-monk': 'mediator',
  // legacy Fluent avatar ids, so old saved choices still resolve
  'persona-01-mascot-bear': 'freshman',
  'persona-02-mascot-alt-owl': 'mediator',
  'persona-03-examiner-teacher': 'examiner',
  'persona-04-chapter-expert-mage': 'expert',
  'persona-05-rival-ninja': 'ta',
  'avatar-01': 'student',
  'avatar-02': 'ta',
  'avatar-03': 'council-balance',
  'avatar-04': 'council-chill',
  'avatar-05': 'council-hard',
  'avatar-06': 'dean',
};

/** Resolve any known id (cast, persona, hub agent, legacy) to a portrait URL. */
export function pixelPortrait(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return PIXEL_PORTRAITS[id] ?? PIXEL_PORTRAITS[ALIASES[id] ?? ''];
}
