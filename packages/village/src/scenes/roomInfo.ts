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
    { name: 'Nook', does: 'Remembers what you missed and brings it back later so it sticks.' },
  ],
  how: {
    phrase: `@nook quiz me on ch${n}`,
    steps: [
      `Type the phrase in your squad chat (or DM Nook).`,
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
      phrase: '@nook quiz me on ch2',
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
      'See both sides of a debatable idea argued well, vote for the one that convinces you, and learn why one was stronger.',
    who: [
      {
        name: 'Two debaters',
        does: 'Take opposite sides and answer each other. On course topics they cite a checked page.',
      },
      {
        name: 'Chairman',
        does: 'Says which argument was stronger and why, and notes if your vote went the other way.',
      },
    ],
    how: {
      phrase: '@nook debate should exams be open book?',
      steps: [
        'Type the phrase with any question worth arguing, or "@nook debate this" for the last message.',
        'Watch the two sides speak, then vote in the confirm card Nook sends you.',
        'Read the chairman verdict in the room or in chat.',
      ],
    },
    outcome:
      'Both arguments, how the room voted, and the chairman verdict with the reason, plus any dissent. Course topics cite the page; others are labelled general reasoning.',
    privacy:
      'Only the question and the arguments are shared. Each vote is a private reply to Nook; the squad sees only the totals.',
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
      phrase: '@nook plan my next semester',
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
      { name: 'Nook', does: 'Gives you short written feedback on your explanation at the end.' },
    ],
    how: {
      phrase: '@nook feynman ch3 gradient descent',
      steps: [
        'Type the phrase with your chapter and the idea you want to explain.',
        'Reply with your explanation, then answer the follow-ups.',
        'Read the feedback Nook sends back.',
      ],
    },
    outcome:
      'Follow-up questions at the spots where your explanation was fuzzy, then feedback on what to tighten. The porch lights up while you are working through it.',
    privacy: 'Your explanation is private to your chat with Nook; the squad is not shown it.',
  },
  'panic-booth': {
    slot: 'panic-booth',
    title: 'Panic Line booth',
    tagline: 'Find where two solutions first split',
    purpose:
      'When you and a friend got different answers, find the first step where your working diverges.',
    who: [
      {
        name: 'Nook',
        does: 'Reads the photos of your handwritten steps and lines them up against each other.',
      },
      {
        name: 'Booth keeper',
        does: 'Posts only the step number where you split, never who was wrong.',
      },
    ],
    how: {
      phrase: '@nook diff',
      steps: [
        'Say it in the group chat; two of you then DM Nook a photo of your work.',
        'Add the word private to compare without showing any steps.',
        'Nook replies once both photos are in.',
      ],
    },
    outcome:
      'The first step where your two solutions differ, not who is right. That concept is queued for both of you to review.',
    privacy:
      'Photos stay between you and Nook. The group only sees the step number where you split.',
  },
  'exam-oracle': {
    slot: 'exam-oracle',
    title: 'Exam Oracle',
    tagline: 'Tells you what to study next',
    purpose:
      'Ranks your chapters by what is due for review, what you find hard and what past exams stress, then names the three topics worth your time.',
    who: [
      {
        name: 'Oracle',
        does: 'Reads your review history and your course material, then phrases a short mock question for each top topic.',
      },
    ],
    how: {
      phrase: '@nook exam oracle',
      steps: [
        'Type the phrase in chat, or ask "what should I study next".',
        'Read the ranked chapters and the three topics, each with a mock question.',
        'Walk in to see the chalk note and the full outcome card.',
      ],
    },
    outcome:
      'A ranked list of chapters, the three best topics with a mock question each, the workload in words and why each was picked. A suggestion only: it never marks your answers.',
    privacy:
      'It uses only your own review history. Your squad sees the topic names, never your boxes or answers.',
  },

  'oral-exam-hut': {
    slot: 'oral-exam-hut',
    title: 'Oral Exam Hut',
    tagline: 'Practise answering out loud',
    purpose:
      'Practise a spoken exam: an examiner asks one question at a time from your chapters, listens, and follows up where you were vague.',
    who: [
      {
        name: 'Examiner',
        does: 'Asks the questions, asks one follow-up if you stay vague, then sums up what to revisit.',
      },
    ],
    how: {
      phrase: '@nook oral exam',
      steps: [
        'Type the phrase in chat, then walk in and press Call.',
        'Answer out loud or type if you have no microphone; captions always show the questions.',
        'The examiner closes with written feedback.',
      ],
    },
    outcome:
      'Three questions with one follow-up each at most, then a feedback summary in words: what was solid and what to revisit. No grades.',
    privacy:
      'Your spoken answers are used for this call and not kept. The squad sees that you practised, not what you said.',
  },

  'rubric-courthouse': {
    slot: 'rubric-courthouse',
    title: 'Rubric Courthouse',
    tagline: 'Checks your answer against the rubric',
    purpose:
      'Compare your own answer with the real rubric from your syllabus or assignment, and see where clarity, accuracy or gaps cost you.',
    who: [
      {
        name: 'Judge',
        does: 'Ticks or crosses Clarity, Accuracy and Gaps and quotes your own words as evidence.',
      },
    ],
    how: {
      phrase: '@nook rubric check',
      steps: [
        'Type the phrase with your answer, or attach a photo or PDF of it.',
        'Paste the rubric, or let Nook find it in your syllabus or assignment.',
        'Read the feedback in chat and in the courthouse.',
      ],
    },
    outcome:
      'A tick or cross for Clarity, Accuracy and Gaps with a comment and a quote from your answer. Feedback only: no grade, and your answer is never rewritten.',
    privacy: 'Your answer stays between you and Nook. The squad sees only that you checked one.',
  },

  'devils-ta': {
    slot: 'devils-ta',
    title: "Devil's TA",
    tagline: 'Spot the mistake hidden in a solution',
    purpose:
      'Train your eye: read a short, convincing explanation from your own chapter and find the one deliberate mistake the TA hid in it.',
    who: [
      {
        name: "Devil's TA",
        does: 'Writes an explanation with exactly one planted error, then checks which line you name.',
      },
    ],
    how: {
      phrase: "@nook devil's TA ch2",
      steps: [
        'Type the phrase with your chapter, or say "@nook find my mistake".',
        'Reply with the line number or the wrong words. You get two tries.',
        'Nook then reveals the error, explains it and cites the page.',
      ],
    },
    outcome:
      'Feedback only: whether you caught it, then the wrong line, the correct statement and the page it comes from. A missed chapter is queued for review.',
    privacy: 'Only you see whether you caught the mistake. Nothing is shared with your squad.',
  },
};

export const roomInfo = (slot: string): RoomInfo | undefined =>
  (ROOM_INFO as Record<string, RoomInfo | undefined>)[slot];

export const ROOM_INFO_SLOTS: readonly RoomSlot[] = ROOM_SLOTS;
