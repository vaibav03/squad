import { ROOM_SLOTS, type RoomInfo, type RoomSlot } from './roomTypes';

/**
 * Student-facing explanation of every room. Copy rules are in roomTypes.ts (RoomInfo). Phrases are
 * only set where a chat skill really matches today (see docs/qa/ROOMS-AUDIT.md); otherwise null and
 * `how.steps` says honestly what happens.
 */

const chapter = (n: 1 | 2 | 3 | 4): RoomInfo => ({
  slot: `chapter-${n}`,
  title: `Chapter ${n} house`,
  tagline: 'Your chapter, one question at a time',
  purpose: `Practise chapter ${n} with short questions taken from your own slides, and see which ideas are solid and which need another pass.`,
  who: [
    {
      name: 'Chapter expert',
      does: 'Asks questions built from your slides and tells you if your answer is right.',
    },
    { name: 'Cubbie', does: 'Remembers what you missed and brings it back later so it sticks.' },
  ],
  how: {
    phrase: `@cubbie quiz me on ch${n}`,
    steps: [
      `Type the phrase in your squad chat (or DM Cubbie).`,
      'Answer each question with a letter or a few words.',
      'Walk in to read the questions and answers as they happen.',
    ],
  },
  outcome:
    'A short quiz on this chapter, then which ideas to revisit and when. The house glows brighter as the chapter sinks in. No grades.',
  privacy:
    'Questions come from your uploaded course material. Your squad sees that you practised, not your individual answers.',
});

export const ROOM_INFO: Readonly<Record<RoomSlot, RoomInfo>> = {
  'chapter-1': chapter(1),
  'chapter-2': chapter(2),
  'chapter-3': chapter(3),
  'chapter-4': chapter(4),
  'council-hall': {
    slot: 'council-hall',
    title: 'Council Hall',
    tagline: 'Checks every quiz answer key before you see it',
    purpose:
      'Makes sure a quiz question has one right answer before it reaches you, so you never study from a wrong key.',
    who: [
      {
        name: 'Three solvers',
        does: 'Each solves the question alone, without seeing the others or the key.',
      },
      {
        name: 'Chair',
        does: 'Compares them with the key and throws the question out if anyone disagrees.',
      },
    ],
    how: {
      phrase: '@cubbie quiz me on ch2',
      steps: [
        'Ask for a quiz as usual; the hall works in the background when a new question is made.',
        'It only runs when answer-key checking is switched on for your squad.',
        'Walk in to read the solvers and the verdict.',
      ],
    },
    outcome:
      'For each new question: the three independent answers, whether they matched the key, and the chair verdict (kept or dropped).',
    privacy: 'Only course questions are discussed here. Nothing about you or your answers.',
  },
  'debate-stage': {
    slot: 'debate-stage',
    title: 'Debate Stage',
    tagline: 'Two sides argue a tricky question',
    purpose:
      'Meant to show both sides of a debatable idea in your course so you can pick a side and defend it.',
    who: [
      {
        name: 'Two debaters',
        does: 'Take opposite sides and answer each other from their lecterns.',
      },
      { name: 'Moderator', does: 'Sums up which argument held up better.' },
    ],
    how: {
      phrase: null,
      steps: [
        'Nothing in chat starts a debate yet, so the stage stays quiet for now.',
        'Walking in shows the empty stage and lecterns.',
      ],
    },
    outcome:
      'Once connected: both arguments side by side and a short closing summary. Today the room shows no live debate.',
    privacy:
      'A debate would use course topics only, nothing personal and nothing shared by default.',
  },
  'round-table': {
    slot: 'round-table',
    title: 'Course-Planning Round Table',
    tagline: 'Three advisors argue out your next term',
    purpose: 'Plan next term with three advisors who argue it out',
    who: [
      { name: 'Chill', does: 'Protects your sleep and proposes the lighter load.' },
      { name: 'Grind', does: 'Packs in credits so you can graduate sooner.' },
      { name: 'Advisor', does: 'Checks prerequisites and degree requirements.' },
      { name: 'Chairman', does: 'Merges the three views into one plan.' },
    ],
    how: {
      phrase: '@cubbie plan my next semester',
      steps: [
        'Type the phrase in chat and list the courses you are considering.',
        'Watch the advisors speak in turn, then rank each other.',
        'Read the chairman plan in the room or in chat.',
      ],
    },
    outcome:
      'A recommended term plan: courses, credit total, workload in words (never grades), the one-line disagreement, and why each advisor argued what they did.',
    privacy:
      'Uses the sample catalogue and the courses you list; nothing is shared with your squad unless you confirm.',
  },
  'feynman-porch': {
    slot: 'feynman-porch',
    title: 'Feynman Porch',
    tagline: 'Explain it simply and find the gaps',
    purpose:
      'Test whether you really understand an idea by explaining it to a confused newcomer who keeps asking why.',
    who: [
      {
        name: 'Freshman',
        does: 'Plays a curious beginner and asks up to two naive follow-up questions.',
      },
      { name: 'Cubbie', does: 'Gives you short written feedback on your explanation at the end.' },
    ],
    how: {
      phrase: '@cubbie feynman ch3 gradient descent',
      steps: [
        'Type the phrase with your chapter and the idea you want to explain.',
        'Reply with your explanation, then answer the follow-ups.',
        'Read the feedback Cubbie sends back.',
      ],
    },
    outcome:
      'Follow-up questions at the spots where your explanation was fuzzy, then feedback on what to tighten. The porch itself does not light up yet.',
    privacy: 'Your explanation is private to your chat with Cubbie; the squad is not shown it.',
  },
  'panic-booth': {
    slot: 'panic-booth',
    title: 'Panic Line booth',
    tagline: 'Find where two solutions first split',
    purpose:
      'When you and a friend got different answers, find the first step where your working diverges.',
    who: [
      {
        name: 'Cubbie',
        does: 'Reads the photos of your handwritten steps and lines them up against each other.',
      },
      { name: 'Dean', does: 'Posts only the step number where you split, never who was wrong.' },
    ],
    how: {
      phrase: '@cubbie diff',
      steps: [
        'Say it in the group chat; two of you then DM Cubbie a photo of your work.',
        'Add the word private to compare without showing any steps.',
        'Cubbie replies once both photos are in.',
      ],
    },
    outcome:
      'The first step where your two solutions differ, not who is right. That concept is queued for both of you to review.',
    privacy:
      'Photos stay between you and Cubbie. The group only sees the step number where you split.',
  },
  'exam-oracle': {
    slot: 'exam-oracle',
    title: 'Exam Oracle',
    tagline: 'Hints at which chapter to study next',
    purpose:
      'Meant to suggest the chapter most worth studying next, so your revision time goes where it counts.',
    who: [
      { name: 'Oracle', does: 'Holds the orb and names the chapter it expects to matter next.' },
    ],
    how: {
      phrase: null,
      steps: [
        'Nothing in chat calls the oracle yet.',
        'Walking in shows the orb; its label appears only when a question for it is asked.',
      ],
    },
    outcome:
      'Once connected: a short chalk note such as "ch5 next?" on the board. Today the oracle makes no prediction.',
    privacy: 'It would use only your own study history. Nothing is shared with your squad.',
  },
  'oral-exam-hut': {
    slot: 'oral-exam-hut',
    title: 'Oral Exam Hut',
    tagline: 'Practise answering out loud',
    purpose:
      'Meant for practising a spoken exam, answering an examiner out loud instead of typing.',
    who: [{ name: 'Examiner', does: 'Asks you questions and speaks through live captions.' }],
    how: {
      phrase: null,
      steps: [
        'Nothing in chat starts an oral exam yet.',
        'The hut stays locked until an examiner call begins.',
      ],
    },
    outcome:
      'Once connected: captions of the examiner questions as they are spoken. Today the hut is empty.',
    privacy: 'A spoken practice would stay between you and the examiner, not your squad.',
  },
  'rubric-courthouse': {
    slot: 'rubric-courthouse',
    title: 'Rubric Courthouse',
    tagline: 'Checks your answer against clear criteria',
    purpose:
      'Meant to check a written answer against three plain criteria so you see what is missing.',
    who: [
      {
        name: 'Judge',
        does: 'Ticks or crosses Clarity, Accuracy and Gaps for each answer you submit.',
      },
    ],
    how: {
      phrase: null,
      steps: [
        'Nothing in chat sends an answer here yet.',
        'Walking in shows the three empty criteria rows.',
      ],
    },
    outcome:
      'Once connected: a tick or cross per criterion, never a number. Today the rows stay empty.',
    privacy: 'Your answers would stay private; only you see the ticks and crosses.',
  },
  'devils-ta': {
    slot: 'devils-ta',
    title: "Devil's TA",
    tagline: 'Spot the mistake hidden in a solution',
    purpose:
      'Meant to train your eye: find the deliberate mistake the TA hid in a worked solution.',
    who: [
      {
        name: "Devil's TA",
        does: 'Hides one sneaky error in a solution and marks whether you caught it.',
      },
    ],
    how: {
      phrase: null,
      steps: [
        'Nothing in chat starts this challenge yet.',
        'Walking in shows the board, which stays blank until a result arrives.',
      ],
    },
    outcome:
      'Once connected: a chalk tick if you caught the mistake or a red underline if you missed it. Today the board stays blank.',
    privacy: 'Only you see whether you caught the mistake. Nothing is shared with your squad.',
  },
};

export const roomInfo = (slot: string): RoomInfo | undefined =>
  (ROOM_INFO as Record<string, RoomInfo | undefined>)[slot];

export const ROOM_INFO_SLOTS: readonly RoomSlot[] = ROOM_SLOTS;
