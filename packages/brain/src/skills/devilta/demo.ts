import { scripted, type NonLiveMode } from '@squad/core';
import type { DevilPlan } from './rules';

/** Built-in demo explanations (course-neutral, no citations). Used only when the model is unavailable. */
export const DEMO_PLANS: readonly DevilPlan[] = [
  {
    lines: [
      'The mean is the sum of the values divided by how many values there are.',
      'The median is the middle value once the data are sorted.',
      'The standard deviation is the square of the variance.',
      'A larger standard deviation means the data are more spread out.',
    ],
    errorLine: 2,
    keywords: ['square', 'variance'],
    whatIsWrong:
      'The standard deviation is the square root of the variance, not its square. The variance is the squared quantity.',
    correct: 'The standard deviation is the square root of the variance.',
  },
  {
    lines: [
      'Binary search needs the list to be sorted.',
      'It compares the target with the middle element.',
      'Each comparison throws away half of the remaining range.',
      'So binary search runs in linear time, O(n).',
    ],
    errorLine: 3,
    keywords: ['linear'],
    whatIsWrong:
      'Halving the range each step gives logarithmic time, O(log n). Linear time is what a plain scan costs.',
    correct: 'So binary search runs in logarithmic time, O(log n).',
  },
  {
    lines: [
      'Gradient descent repeatedly updates the parameters.',
      'Each update moves the parameters in the same direction as the gradient to reduce the loss.',
      'The learning rate scales the size of each step.',
      'A learning rate that is too large can overshoot the minimum.',
    ],
    errorLine: 1,
    keywords: ['same direction'],
    whatIsWrong:
      'The gradient points uphill, so to reduce the loss each update moves against it (the opposite direction).',
    correct:
      'Each update moves the parameters in the direction opposite to the gradient to reduce the loss.',
  },
];

export const pickDemo = (n: number): DevilPlan => DEMO_PLANS[Math.abs(n) % DEMO_PLANS.length]!;

/** The built-in sample with every visible string branded as scripted (the only way the skill uses the demo plans). */
export function pickDemoScripted(n: number, mode: NonLiveMode): DevilPlan {
  const p = DEMO_PLANS[Math.abs(n) % DEMO_PLANS.length]!;
  const b = (t: string): string => scripted(t, mode).text;
  return {
    ...p,
    lines: p.lines.map(b),
    whatIsWrong: b(p.whatIsWrong),
    correct: b(p.correct),
  };
}
