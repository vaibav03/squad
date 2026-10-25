import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('handles 0, 1 and 2', () => {
    expect(plural(0, 'item')).toBe('0 items');
    expect(plural(1, 'Classroom item')).toBe('1 Classroom item');
    expect(plural(2, 'Classroom item')).toBe('2 Classroom items');
    expect(plural(1, 'calendar event')).toBe('1 calendar event');
    expect(plural(2, 'excerpt')).toBe('2 excerpts');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });
});
