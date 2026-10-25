// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { findLeak } from '@squad/core';
import { createInspectorStore } from '@squad/village/inspector';
import { InspectorPanel } from './index';

afterEach(cleanup);
const settle = async (ms = 80) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function setup() {
  const store = createInspectorStore({ me: 's_ana' });
  store.apply({
    t: 'agent.state',
    agent: 'expert:ch6',
    state: 'studying',
    thought: 'Comparing two examples of correlation',
    work: { tier: 'fast', demo: true, thinking: true },
  });
  store.apply({ t: 'agent.state', agent: 'student:s_ben', state: 'studying', thought: 'Ben has $180 for therapy' });
  store.apply({ t: 'ledger.entry', taskId: 't', student: 's_ben', field: 'budget', shared: '$180' });
  return store;
}

describe('InspectorPanel', () => {
  it('shows the headline, thinking, tier, demo and live log for the selected agent', async () => {
    const store = setup();
    render(<InspectorPanel store={store} />);
    expect(screen.queryByRole('complementary')).toBeNull();
    act(() => store.select('expert:ch6'));
    await settle();
    expect(screen.getByRole('complementary', { name: 'Chapter 6 expert' })).toBeTruthy();
    expect(screen.getByText('Studying in the Chapter 6 house')).toBeTruthy();
    expect(screen.getByText('Fast model')).toBeTruthy();
    expect(screen.getByText('Demo mode')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Thinking now' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Thinking/ }));
    expect(screen.getByText('Comparing two examples of correlation')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Doing' }));
    // live update
    act(() => store.apply({ t: 'quiz.question', quizId: 'q', chapter: 'ch6', target: 's_ana', text: 'What is r squared?' }));
    expect(screen.getByText('Asking Ana a question on Chapter 6')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Thinking/ }));
    expect(screen.getByText('Working on: What is r squared?')).toBeTruthy();
  });
  it('is honest when no reasoning was shared', async () => {
    const store = setup();
    act(() => store.apply({ t: 'agent.state', agent: 'dean', state: 'studying' }));
    render(<InspectorPanel store={store} />);
    act(() => store.select('dean'));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Thinking' }));
    expect(screen.getByText('Working on it: no reasoning shared yet')).toBeTruthy();
  });
  it('Esc closes and returns focus to the stage; cycle buttons move between agents', async () => {
    const store = setup();
    const stage = document.createElement('div');
    stage.tabIndex = 0;
    document.body.appendChild(stage);
    render(<InspectorPanel store={store} returnFocusTo={() => stage} />);
    act(() => store.select('student:s_ana'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Next agent' }));
    expect(store.selected).toBe('student:s_ben');
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(store.follow).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(store.selected).toBeNull();
    expect(store.follow).toBe(false);
    expect(document.activeElement).toBe(stage);
    stage.remove();
  });
  it('Agents tab: thread with arrows, partner chips that select, dissent flagged', async () => {
    const store = setup();
    act(() => {
      store.apply({ t: 'agent.message', from: 'student:s_ana', to: 'student:s_ben', taskId: 't', kind: 'psi.tokens', shared: ['168 blinded tokens'], message: 'Here are my blinded evenings' });
      store.apply({ t: 'council.verdict', councilId: 'council:q1', member: 'advisor', text: 'Start with chapter 5', dissenter: 'grind' });
      store.select('student:s_ana');
    });
    render(<InspectorPanel store={store} />);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }));
    expect(screen.getByText('Here are my blinded evenings')).toBeTruthy();
    expect(screen.getAllByText(/Dissent recorded/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ben' })[0]!);
    expect(store.selected).toBe('student:s_ben');
  });
  it('Chat tab: expert call lines with a citation chip; others chats stay private', async () => {
    const store = setup();
    act(() => {
      store.apply({ t: 'call.start', agent: 'expert:ch6', callId: 'c', student: 's_ana' });
      store.apply({ t: 'call.caption', agent: 'expert:ch6', callId: 'c', text: 'r tells direction', cite: { courseId: 'x', chapter: 'ch6', file: 'ch6.pdf', page: 3 } });
      store.select('expert:ch6');
    });
    render(<InspectorPanel store={store} />);
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByText('r tells direction')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Source: ch6.pdf, page 3/ })).toBeTruthy();
    act(() => store.select('student:s_ben'));
    await settle();
    expect(screen.getByText(/chats are private to them/)).toBeTruthy();
    expect(findLeak(document.body.textContent ?? '')).toBeUndefined();
  });
  it("another student's inspector never shows withheld values", async () => {
    const store = setup();
    render(<InspectorPanel store={store} />);
    act(() => store.select('student:s_ben'));
    await settle();
    const html = document.body.textContent ?? '';
    expect(findLeak(html)).toBeUndefined();
    expect(screen.getByText(/Public activity only/)).toBeTruthy();
  });
});
