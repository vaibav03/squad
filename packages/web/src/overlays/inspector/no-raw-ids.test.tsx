// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clearRoster, createInspectorStore, setRoster } from '@squad/village/inspector';
import { InspectorPanel } from './InspectorPanel';

const RAW = /\b[us]_[0-9a-f]{6,}\b|\bU [a-z0-9]{8,}\b/i;
const ME = 'u_a193aba6d4e4';
const OTHER = 'u_9f3c0a7be211';

/** Every rendered text node and every aria-live / aria-label / title / alt attribute under the body. */
function scan(): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n.textContent ?? '');
  document.body.querySelectorAll('*').forEach((el) => {
    for (const a of ['aria-label', 'title', 'alt', 'aria-valuetext', 'placeholder'])
      if (el.hasAttribute(a)) out.push(el.getAttribute(a) ?? '');
  });
  return out;
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

afterEach(() => {
  cleanup();
  clearRoster();
});

describe('no raw ids while cycling the inspector', () => {
  for (const roster of [false, true])
    for (const me of [ME, `s_${ME}`]) {
      it(`roster=${roster} me=${me}`, async () => {
        clearRoster();
        if (roster)
          setRoster(
            [
              { id: ME, name: 'Maya Rao' },
              { id: OTHER, name: 'Sam Lee' },
            ],
            { id: ME, name: 'Maya Rao' },
          );
        const store = createInspectorStore({ me });
        for (const id of [me, OTHER, `s_${OTHER}`]) {
          store.apply({ t: 'agent.state', agent: `student:${id}`, state: 'studying' });
          store.apply({
            t: 'agent.message',
            from: `student:${id}`,
            to: 'mediator',
            kind: 'conflict',
          });
        }
        store.apply({ t: 'agent.state', agent: 'expert:ch5', state: 'in_call' });
        store.apply({
          t: 'council.opinion',
          councilId: 'council:planner',
          member: 'chill',
          text: 'x',
        });
        render(<InspectorPanel store={store} />);
        act(() => store.select(`student:${me}`));
        await settle();
        const ids = store.ids();
        for (let i = 0; i < ids.length * 2 + 2; i++) {
          for (const tab of ['Doing', 'Thinking', 'Chat', 'Agents']) {
            fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
            for (const t of scan()) expect(t, `step ${i} ${tab}`).not.toMatch(RAW);
          }
          fireEvent.click(
            screen.getByRole('button', { name: i < ids.length ? 'Next agent' : 'Previous agent' }),
          );
          await settle();
        }
      });
    }
});
