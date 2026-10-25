// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInspectorStore } from '@squad/village/inspector';
import { InspectorPanel } from './InspectorPanel';
import { InspectableVoice } from './InspectableVoice';
import { setInspectorStore } from './bridge';
import { hubStudentId } from '../../shell/dev-login';

const settle = () => act(async () => new Promise((r) => setTimeout(r, 350)));

afterEach(() => {
  cleanup();
  setInspectorStore(null);
});

describe('council voices in the inspector', () => {
  it('real account ids are not prefixed again', () => {
    expect(hubStudentId('u_a193aba6d4e4')).toBe('u_a193aba6d4e4');
    expect(hubStudentId('ana')).toBe('s_ana');
  });

  it('pressing a council name opens Thinking when it has a thought, with positions and chat', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.apply({
      t: 'council.opinion',
      councilId: 'council:planner',
      member: 'chill',
      text: 'Two short evenings are enough.',
      thought: 'Light plan if the quiz went well',
    });
    store.apply({
      t: 'council.opinion',
      councilId: 'council:planner',
      member: 'grind',
      text: 'Regression needs a third pass.',
      dissent: true,
    });
    setInspectorStore(store);
    render(
      <>
        <InspectableVoice who="chill" name="Chill" slot="round-table">
          Chill
        </InspectableVoice>
        <InspectorPanel store={store} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chill.*Open in the inspector/ }));
    await settle();
    expect(screen.getByRole('tab', { name: 'Thinking', selected: true })).toBeTruthy();
    expect(screen.getByText('Light plan if the quiz went well')).toBeTruthy();
    expect(screen.getByText('Regression needs a third pass.')).toBeTruthy(); // other members' positions
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByRole('button', { name: /^Just Chill/ })).toBeTruthy();
    expect(screen.getByText('Two short evenings are enough.')).toBeTruthy();
    expect(screen.getByText('Regression needs a third pass.')).toBeTruthy();
  });

  it('a voice with nothing yet opens on Chat; thinking dots show on the tag', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    setInspectorStore(store);
    render(
      <>
        <InspectableVoice who="advisor" name="Advisor" slot="round-table">
          Advisor
        </InspectableVoice>
        <InspectorPanel store={store} />
      </>,
    );
    act(() => store.setVoiceThinking('advisor', true));
    expect(document.querySelector('.ai-voice__tag .ai-dots')).toBeTruthy();
    act(() => store.setVoiceThinking('advisor', false));
    fireEvent.click(screen.getByRole('button', { name: /Advisor/ }));
    await settle();
    expect(screen.getByRole('tab', { name: 'Chat', selected: true })).toBeTruthy();
  });

  it('renders no button without a village inspector', () => {
    render(
      <InspectableVoice who="chill" name="Chill">
        Chill
      </InspectableVoice>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
