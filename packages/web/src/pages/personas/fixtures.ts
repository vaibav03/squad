export interface VoiceOption {
  id: string;
  name: string;
  character: string;
  tags: string[];
  seed: number;
  pitch: number;
}
export interface PersonaDraft {
  id: string;
  name: string;
  role: string;
  blurb: string;
  voiceId: string;
  avatarId: string;
  sample: string;
}

export const VOICES: VoiceOption[] = [
  {
    id: 'calm-professor',
    name: 'Calm professor',
    character: 'Slow, warm and patient',
    tags: ['Low', 'Steady'],
    seed: 11,
    pitch: 118,
  },
  {
    id: 'hype-coach',
    name: 'Hype coach',
    character: 'Quick, upbeat, always encouraging',
    tags: ['High', 'Fast'],
    seed: 23,
    pitch: 205,
  },
  {
    id: 'night-owl',
    name: 'Night owl',
    character: 'Soft and unhurried, good for late sessions',
    tags: ['Mid', 'Soft'],
    seed: 37,
    pitch: 150,
  },
  {
    id: 'stern-examiner',
    name: 'Stern examiner',
    character: 'Clipped and exact, like a real oral exam',
    tags: ['Low', 'Crisp'],
    seed: 41,
    pitch: 105,
  },
  {
    id: 'friendly-ta',
    name: 'Friendly TA',
    character: 'Casual and clear, explains like a classmate',
    tags: ['Mid', 'Bright'],
    seed: 53,
    pitch: 178,
  },
  {
    id: 'storyteller',
    name: 'Storyteller',
    character: 'Rolling and expressive, makes facts stick',
    tags: ['Mid', 'Rich'],
    seed: 67,
    pitch: 138,
  },
  {
    id: 'sprinter',
    name: 'Sprinter',
    character: 'Brisk summaries for quick review',
    tags: ['High', 'Fast'],
    seed: 71,
    pitch: 220,
  },
  {
    id: 'librarian',
    name: 'Librarian',
    character: 'Hushed, gentle and careful',
    tags: ['Low', 'Soft'],
    seed: 83,
    pitch: 126,
  },
];

export const PERSONAS: PersonaDraft[] = [
  {
    id: 'buddy',
    name: 'Study buddy',
    role: 'Your daily companion',
    blurb: 'Keeps you company, nudges you, and rounds up your squad.',
    voiceId: 'friendly-ta',
    avatarId: 'persona-01-mascot-bear',
    sample: 'Ready when you are. Which chapter should we start with?',
  },
  {
    id: 'expert',
    name: 'Chapter expert',
    role: 'Knows one chapter inside out',
    blurb: 'Answers from your own course PDFs and cites the page.',
    voiceId: 'calm-professor',
    avatarId: 'persona-04-chapter-expert-mage',
    sample: 'Glycolysis happens in the cytoplasm. The details are on page twelve.',
  },
  {
    id: 'examiner',
    name: 'Examiner',
    role: 'Quizzes you like the real exam',
    blurb: 'Asks, listens, and tells you where your answer slipped.',
    voiceId: 'stern-examiner',
    avatarId: 'persona-03-examiner-teacher',
    sample: 'Explain, in your own words, why the cell needs oxygen.',
  },
  {
    id: 'dean',
    name: 'Dean',
    role: 'Routes your question to the right expert',
    blurb: 'Knows who in the village can answer, and says so honestly.',
    voiceId: 'librarian',
    avatarId: 'avatar-06',
    sample: 'That sounds like a chapter five question. I will bring you to the expert.',
  },
  {
    id: 'council',
    name: 'Council',
    role: 'Several experts, one verdict',
    blurb: 'Debates quietly, then gives you a single ranked answer.',
    voiceId: 'storyteller',
    avatarId: 'avatar-03',
    sample: 'We disagreed on step three, so here is how each of us sees it.',
  },
  {
    id: 'rival',
    name: 'Friendly rival',
    role: 'Keeps you honest',
    blurb: 'Pushes you to try one more problem before you stop.',
    voiceId: 'hype-coach',
    avatarId: 'persona-05-rival-ninja',
    sample: 'Bet you cannot do the next three without looking. Go.',
  },
];
