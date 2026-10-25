import { describe, expect, it } from 'vitest';
import { relevanceOf } from './relevance';

const src = (title: string) => ({ title, courseId: 'c1' });
const chunk = (text: string) => ({ text, section: null });

describe('relevanceOf', () => {
  it('a HIST reading response is not about HIST 140 discussion details', () => {
    const r = relevanceOf(
      'what are the HIST 140 discussion details?',
      src('HIST 215 Reading response: Atlantic trade'),
      chunk('Course: HIST 215\nWrite a reading response on the Atlantic trade essays.'),
    );
    expect(r.onTopic).toBe(false);
  });
  it('the matching course source is on topic', () => {
    expect(
      relevanceOf(
        'what are the HIST 140 discussion details?',
        src('HIST 140 Discussion 3'),
        chunk('Course: HIST 140\nDiscussion details: post by Friday and reply to two classmates.'),
      ).onTopic,
    ).toBe(true);
  });
  it('a body-only topic still counts (title not required)', () => {
    expect(
      relevanceOf('what is the zorblatt coefficient', src('Notes'), chunk('The Zorblatt coefficient measures how things drift.')).onTopic,
    ).toBe(true);
  });
  it('one shared generic word is not enough', () => {
    expect(relevanceOf('explain mitochondria energy production', src('Essay'), chunk('Submit the essay on energy policy.')).onTopic).toBe(false);
  });
});
