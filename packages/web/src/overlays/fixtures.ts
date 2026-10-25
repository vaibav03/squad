// Ready-made props for every overlay state: used by the gallery, the review harness and village-side tests.
import type { Citation } from '@squad/core';
import type { CallPanelProps, ConfirmSheetProps, QuizCardProps, QuizPayload } from './types';

const noop = () => {};
const base = { open: true, onClose: noop } as const;

const cite = (chapter: string, page: number, quote?: string): Citation => ({
  courseId: 'bio101',
  chapter,
  file: 'openstax-biology-ch5.pdf',
  page,
  ...(quote ? { quote } : {}),
});

const expert = { id: 'expert:ch5', name: 'Ch5 Expert', role: 'Chapter expert, cell energy' };

const callBase: CallPanelProps = {
  ...base,
  agent: expert,
  status: 'live',
  captions: [],
  speaking: 'none',
  muted: false,
  onMuteChange: noop,
  handRaised: false,
  onHandRaiseChange: noop,
  onLeave: noop,
  elapsedMs: 74_000,
};

const captions: CallPanelProps['captions'] = [
  { id: 'c:0', speaker: 'agent', text: 'Welcome back. Want to start with where glycolysis happens, or go straight to the electron transport chain?' },
  { id: 'c:1', speaker: 'you', text: 'Start with glycolysis. I keep mixing up what it produces.' },
  {
    id: 'c:2',
    speaker: 'agent',
    text: 'Glycolysis splits one glucose into two pyruvate and nets two ATP and two NADH, all in the cytosol.',
    cite: cite('Ch5', 12, 'The net gain from glycolysis is two ATP and two NADH per glucose.'),
  },
  {
    id: 'c:3',
    speaker: 'agent',
    text: 'Oxygen is not needed for that step, which is why it is the oldest pathway in the cell.',
    cite: cite('Ch5', 13),
  },
];

export const callPanelFixtures = {
  connecting: { ...callBase, status: 'connecting', elapsedMs: undefined, muted: false } satisfies CallPanelProps,
  'live-empty': { ...callBase, captions: [], speaking: 'none', level: 0.1 } satisfies CallPanelProps,
  'live-agent-speaking': { ...callBase, captions: captions.slice(0, 3), speaking: 'agent', level: 0.78 } satisfies CallPanelProps,
  'live-you-speaking': { ...callBase, captions: captions.slice(0, 2), speaking: 'you', level: 0.55 } satisfies CallPanelProps,
  muted: { ...callBase, captions: captions.slice(0, 3), speaking: 'none', muted: true, level: 0.05 } satisfies CallPanelProps,
  'hand-raised': { ...callBase, captions, speaking: 'none', handRaised: true, level: 0.05 } satisfies CallPanelProps,
  'long-captions': {
    ...callBase,
    captions: [...captions, ...captions.map((c) => ({ ...c, id: `${c.id}-b` })), ...captions.map((c) => ({ ...c, id: `${c.id}-c` }))],
    speaking: 'agent',
    level: 0.6,
  } satisfies CallPanelProps,
  reconnecting: {
    ...callBase,
    status: 'reconnecting',
    captions: captions.slice(0, 2),
    message: 'The line dropped for a moment. Trying to get it back.',
    speaking: 'none',
  } satisfies CallPanelProps,
  error: {
    ...callBase,
    status: 'error',
    captions: captions.slice(0, 2),
    message: 'The call could not stay connected.',
    onRetry: noop,
    speaking: 'none',
  } satisfies CallPanelProps,
  ended: { ...callBase, status: 'ended', captions: captions.slice(0, 3), speaking: 'none' } satisfies CallPanelProps,
} as const;

const choiceQuiz: QuizPayload = {
  quizId: 'q_ch5_2',
  chapter: 'Ch5',
  label: 'Q2',
  question: 'Where in the cell does glycolysis take place?',
  choices: [
    { id: 'a', label: 'The mitochondrial matrix' },
    { id: 'b', label: 'The cytosol' },
    { id: 'c', label: 'The inner mitochondrial membrane' },
    { id: 'd', label: 'The nucleus' },
  ],
};
const freeQuiz: QuizPayload = {
  quizId: 'q_ch5_4',
  chapter: 'Ch5',
  label: 'Q4',
  question: 'In your own words, why does the electron transport chain need oxygen?',
};
const quizBase = { ...base, onSubmit: noop, onRetry: noop } as const;

export const quizCardFixtures = {
  loading: { ...quizBase, phase: 'loading' } satisfies QuizCardProps,
  'answering-choices': { ...quizBase, phase: 'answering', quiz: choiceQuiz } satisfies QuizCardProps,
  'answering-free-text': { ...quizBase, phase: 'answering', quiz: freeQuiz } satisfies QuizCardProps,
  submitting: { ...quizBase, phase: 'submitting', quiz: choiceQuiz } satisfies QuizCardProps,
  'done-recorded': { ...quizBase, phase: 'done', quiz: choiceQuiz, result: { recorded: true } } satisfies QuizCardProps,
  'done-correct': {
    ...quizBase,
    phase: 'done',
    quiz: choiceQuiz,
    result: { recorded: true, correct: true, explanation: 'Glycolysis runs in the cytosol. No organelle is needed, which is why it is shared by almost every cell.' },
  } satisfies QuizCardProps,
  'done-incorrect': {
    ...quizBase,
    phase: 'done',
    quiz: choiceQuiz,
    result: { recorded: true, correct: false, explanation: 'The matrix hosts the citric acid cycle. Glycolysis happens earlier, in the cytosol.' },
  } satisfies QuizCardProps,
  error: { ...quizBase, phase: 'error', message: 'We could not send your answer. Check your connection and try again.', quiz: choiceQuiz } satisfies QuizCardProps,
  'load-error': { ...quizBase, phase: 'error', message: 'This question did not load.' } satisfies QuizCardProps,
  'long-question': {
    ...quizBase,
    phase: 'answering',
    quiz: {
      quizId: 'q_long',
      chapter: 'Ch7',
      label: 'Q5',
      question:
        'A researcher blocks the final step of the electron transport chain in cultured cells and then watches ATP output, proton gradient strength, and NADH levels over the next ten minutes. Which pattern should she expect to see first?',
      choices: [
        { id: 'a', label: 'ATP falls, the proton gradient collapses, NADH piles up because it cannot be re-oxidised' },
        { id: 'b', label: 'ATP rises because electrons no longer leak' },
        { id: 'c', label: 'No change until glycolysis is also blocked' },
      ],
    },
  } satisfies QuizCardProps,
} as const;

const confirmBase = { ...base, onChoose: noop } as const;
export const confirmSheetFixtures = {
  'yes-no': {
    ...confirmBase,
    question: 'Book Tuesday 2 to 4 pm in the library for your group study?',
  } satisfies ConfirmSheetProps,
  'three-options': {
    ...confirmBase,
    question: 'Which slot should your agent offer the group?',
    options: ['Tuesday 2 pm', 'Wednesday 5 pm', 'Neither'],
  } satisfies ConfirmSheetProps,
  details: {
    ...confirmBase,
    question: 'Confirm Cabo for March 14 to 18?',
    details: [
      { label: 'Shares', value: 'Cabo, March 14 to 18', tone: 'shared' },
      { label: 'Shares', value: 'Your yes', tone: 'shared' },
      { label: 'Keeps private', value: 'Your budget and your class schedule', tone: 'private' },
    ],
  } satisfies ConfirmSheetProps,
  submitting: { ...confirmBase, question: 'Confirm Cabo for March 14 to 18?', phase: 'submitting' } satisfies ConfirmSheetProps,
  done: { ...confirmBase, question: 'Confirm Cabo for March 14 to 18?', phase: 'done' } satisfies ConfirmSheetProps,
  error: { ...confirmBase, question: 'Confirm Cabo for March 14 to 18?', phase: 'error', message: 'Your answer did not go through. Try again.' } satisfies ConfirmSheetProps,
  'long-question': {
    ...confirmBase,
    question:
      'Your agent found one slot that works for all four of you: Thursday 6 to 8 pm in the Hayden Library group room. Should it send the calendar invite to the group now?',
    details: [{ label: 'Shares', value: 'Thursday 6 to 8 pm', tone: 'shared' }],
  } satisfies ConfirmSheetProps,
} as const;
