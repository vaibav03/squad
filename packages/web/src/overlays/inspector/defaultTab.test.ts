import { describe, expect, it } from 'vitest';
import { defaultTab } from './defaultTab';

const thinking = { thinking: true, hasThought: false };
const thought = { thinking: false, hasThought: true };
const quiet = { thinking: false, hasThought: false };

describe('inspector default tab', () => {
  it('a seat click inside a room (initialTab chat) always opens the Chat tab, even for a thinking agent', () => {
    expect(defaultTab('chat', thinking)).toBe('chat');
    expect(defaultTab('chat', thought)).toBe('chat');
    expect(defaultTab('chat', quiet)).toBe('chat');
    expect(defaultTab('chat', null)).toBe('chat');
  });

  it('without an initial tab (sprite, chip, name chip) a council voice opens on Thinking when it is thinking or has a recent thought, else Chat', () => {
    expect(defaultTab(undefined, thinking)).toBe('thinking');
    expect(defaultTab(undefined, thought)).toBe('thinking');
    expect(defaultTab(undefined, quiet)).toBe('chat');
  });

  it('without an initial tab a plain agent keeps the current tab', () => {
    expect(defaultTab(undefined, null)).toBeNull();
  });
});
