// Local fixtures for tests and the dev harness (not exported from the package index).
import type { RoomOutcome } from '@squad/core';
import type { RoomInfo } from '@squad/village/rooms';

export const FIXTURE_INFO: RoomInfo = {
  slot: 'round-table',
  title: 'Course-Planning Round Table',
  tagline: 'Three advisors argue your term plan, then agree on one.',
  purpose:
    'Pick next term’s courses without doing the juggling yourself. The table weighs workload, prerequisites and how much you want a life.',
  who: [
    { name: 'Chill', does: 'pushes for a lighter load so you stay sane.' },
    { name: 'Grind', does: 'pushes for more credits so you graduate on time.' },
    { name: 'Advisor', does: 'checks prerequisites and caps the plan at what is realistic.' },
  ],
  how: {
    phrase: 'plan my fall term',
    steps: [
      'Walk up to the round table.',
      'Say the phrase in chat, or press Run it.',
      'Watch the three of them argue, then read the plan.',
    ],
  },
  outcome: 'A term plan: the courses, the credits, how heavy it feels, and who disagreed.',
  privacy: 'Only what you share with your squad is used. Nothing private leaves your device.',
};

export const FIXTURE_OUTCOME: RoomOutcome = {
  title: 'Fall term plan',
  summary: 'Five courses that keep you on track without a brutal week.',
  items: [
    { label: 'CS 201 Data Structures', detail: 'Core, needed for every later CS course' },
    { label: 'MATH 210 Linear Algebra', detail: 'Prerequisite for the ML elective' },
    { label: 'STAT 230 Probability', detail: 'Pairs well with Linear Algebra' },
    { label: 'ENG 150 Technical Writing', detail: 'Light and fills a requirement' },
    { label: 'PSY 101 Intro Psychology', detail: 'An easy elective to balance the week' },
  ],
  facts: [
    { label: 'Credits', value: '15' },
    { label: 'Workload', value: 'steady' },
  ],
  dissent: 'Grind wanted 18 credits; the advisor capped it at 16 for prerequisite load.',
  why: [
    { who: 'chill', text: 'Five courses is enough; a sixth would eat your weekends.' },
    { who: 'grind', text: 'Fifteen credits keeps graduation on schedule.' },
    { who: 'advisor', text: 'Data Structures first, because three later courses need it.' },
  ],
};
