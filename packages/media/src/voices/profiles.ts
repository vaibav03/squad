/**
 * Voice profile per persona: the description fed to ElevenLabs voice design, the sample line used
 * for previews, and a one-line style (used by fallback engines). Persona ids follow the media-art
 * registry; unknown ids resolve by role (`resolveProfileKey`), so new experts just work.
 */
export interface VoiceProfile {
  key: string;
  name: string;
  description: string;
  sample: string;
  style: string;
}

const PREVIEW = (line: string) =>
  `${line} That is the whole idea, and honestly it clicks once you see one worked example from the chapter.`.padEnd(
    100,
    ' ',
  );

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    key: 'cubbie',
    name: 'Squad Cubbie',
    description:
      'A warm, upbeat young adult voice with a friendly bear-like gentleness, clear diction, quick and encouraging, a hint of a smile in every sentence. Podcast host energy.',
    sample: PREVIEW('Hey team, quick recap time. Here is what actually matters from this chapter.'),
    style: 'Warm, upbeat, encouraging podcast host.',
  },
  {
    key: 'rival',
    name: 'Squad Rival',
    description:
      'A sharp, slightly sarcastic young adult voice, skeptical and quick, playful competitive edge, asks pointed why questions, medium-low pitch.',
    sample: PREVIEW('Okay but why does that hold? I am not buying it until you show me.'),
    style: 'Skeptical, playful, a little smug.',
  },
  {
    key: 'examiner',
    name: 'Squad Examiner',
    description:
      'A calm, precise middle-aged teacher voice, measured pace, crisp consonants, quietly authoritative, never harsh.',
    sample: PREVIEW('Question one. State the principle, then justify it in a single sentence.'),
    style: 'Calm, precise, authoritative teacher.',
  },
  {
    key: 'expert',
    name: 'Squad Chapter Expert',
    description:
      'A calm British professor, mid-fifties, warm and unhurried, gentle humour, explains with patient clarity.',
    sample: PREVIEW('Right, let us take this one step at a time, and start from the definition.'),
    style: 'Calm, patient British professor.',
  },
  {
    key: 'dean',
    name: 'Squad Dean',
    description:
      'A dignified older voice, deep and steady, formal but kind, speaks like a university dean addressing a hall.',
    sample: PREVIEW('Let the record show that the committee has weighed every argument carefully.'),
    style: 'Formal, deep, steady.',
  },
  {
    key: 'council',
    name: 'Squad Council Member',
    description:
      'A thoughtful adult voice, even-tempered, conversational, slightly dry, sounds like a considered second opinion.',
    sample: PREVIEW('My view is a little different, and here is the reasoning behind it.'),
    style: 'Thoughtful, even, slightly dry.',
  },
  {
    key: 'chairman',
    name: 'Squad Chairman',
    description:
      'A gravelly, confident older voice with ceremonial gravitas, slow deliberate cadence, delivers verdicts.',
    sample: PREVIEW('Having heard the council, I will now give the verdict of this chamber.'),
    style: 'Gravelly, ceremonial, deliberate.',
  },
  {
    key: 'feynman',
    name: 'Squad Freshman',
    description:
      'A curious, eager first-year student voice, bright and slightly hesitant, asks naive questions with real wonder.',
    sample: PREVIEW(
      'Wait, so you are saying it just works because of that? Can you explain it like I am new?',
    ),
    style: 'Bright, curious, slightly hesitant.',
  },
];

const BY_KEY = new Map(VOICE_PROFILES.map((p) => [p.key, p]));

/** Map any persona/agent id to a profile key. `expert:ch5`, `council:2`, `persona-04-chapter-expert-mage` all resolve. */
export function resolveProfileKey(personaId: string): string {
  const id = personaId.toLowerCase();
  if (BY_KEY.has(id)) return id;
  const checks: [RegExp, string][] = [
    [/cubbie|mascot|bear|owl/, 'cubbie'],
    [/rival|ninja/, 'rival'],
    [/examiner|teacher|quiz/, 'examiner'],
    [/chairman|chair/, 'chairman'],
    [/dean/, 'dean'],
    [/council/, 'council'],
    [/feynman|fresh/, 'feynman'],
    [/expert|mage|chapter|professor/, 'expert'],
  ];
  for (const [re, key] of checks) if (re.test(id)) return key;
  return 'cubbie';
}

export function getProfile(personaId: string): VoiceProfile {
  return BY_KEY.get(resolveProfileKey(personaId))!;
}
