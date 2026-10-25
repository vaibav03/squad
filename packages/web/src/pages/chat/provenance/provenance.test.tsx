// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage, Provenance } from '@squad/core';
import { ProvenanceRow } from './ProvenanceRow';
import { MessageBubble } from '../Bubble';
import { planView } from '../../../overlays/plan/fixtures';
import { PlanChatCard } from '../PlanChatCard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm_1',
  seq: 1,
  chatId: 'group:sq_demo',
  ts: 1000,
  sender: { kind: 'persona', id: 'cubbie', name: 'Nook' },
  text: 'The mean is the centre. [ch6.pdf p.4]',
  private: false,
  attachments: [],
  citations: [],
  demo: false,
  ...over,
});
const prov = (over: Partial<Provenance>): Provenance => ({
  kind: 'grounded',
  label: '2 sources',
  sources: 2,
  mode: 'live',
  ...over,
});

describe('ProvenanceRow', () => {
  it.each([
    ['grounded', prov({}), '2 sources', 'Live'],
    [
      'no_sources',
      prov({ kind: 'no_sources', label: 'No course sources used', sources: 0 }),
      'No course sources used',
      'Live',
    ],
    [
      'sample',
      prov({ kind: 'sample', label: 'Not grounded: sample data', sources: 0, mode: 'degraded' }),
      'Not grounded: sample data',
      'Degraded',
    ],
    [
      'demo',
      prov({ kind: 'demo', label: 'Demo: scripted, not Gemini', sources: 0, mode: 'demo' }),
      'Demo: scripted, not Gemini',
      'Demo',
    ],
    [
      'ungrounded',
      prov({
        kind: 'ungrounded',
        label: 'Not grounded: cited sources could not be verified',
        sources: 0,
      }),
      'Not grounded: cited sources could not be verified',
      'Live',
    ],
  ])('%s', (kind, p, label, mode) => {
    render(<ProvenanceRow message={msg({ provenance: p })} />);
    expect(screen.getByTestId('chat-provenance').getAttribute('data-kind')).toBe(kind);
    expect(screen.getByTestId('chat-provenance-label').textContent).toBe(label);
    expect(screen.getByTestId('chat-provenance-mode').textContent).toBe(mode);
    expect(screen.getByTestId('chat-provenance-via').textContent).toBe('via web');
  });
  it('says via iMessage and handles legacy messages', () => {
    const { rerender } = render(
      <ProvenanceRow message={msg({ provenance: prov({ via: 'imessage' }) })} />,
    );
    expect(screen.getByTestId('chat-provenance-via').textContent).toBe('via iMessage');
    rerender(<ProvenanceRow message={msg()} />);
    expect(screen.getByTestId('chat-provenance-label').textContent).toBe('Provenance not recorded');
  });
});

const bubble = (m: ChatMessage, onCite = vi.fn()) =>
  render(
    <MessageBubble
      row={
        {
          kind: 'msg',
          key: m.id,
          message: m,
          head: true,
          tail: true,
          own: false,
          state: 'sent',
        } as never
      }
      api={null}
      status={null}
      me="s_ana"
      isNew={false}
      reduced
      onCite={onCite}
      onRetry={() => {}}
      onDiscard={() => {}}
      quizAnswer={() => undefined}
      onQuizAnswer={async () => true}
      onConfirm={async () => 'ok' as never}
    />,
  );

describe('Bubble provenance', () => {
  it('shows chips and the row for a grounded reply, and chips open the sheet', () => {
    const onCite = vi.fn();
    bubble(
      msg({
        citations: [{ file: 'ch6.pdf', page: 4, label: 'ch6.pdf p.4' }],
        provenance: prov({ label: '1 source', sources: 1 }),
      }),
      onCite,
    );
    fireEvent.click(screen.getByTestId('chat-citation-chip'));
    expect(onCite).toHaveBeenCalled();
    expect(screen.getByTestId('chat-provenance-label').textContent).toBe('1 source');
  });
  it('chips render from structured citations even without text markers', () => {
    bubble(
      msg({
        text: 'Due Friday.',
        citations: [
          {
            file: 'Syllabus',
            page: 1,
            label: 'Syllabus',
            source: { kind: 'canvas_file', id: 'f1', title: 'Syllabus' },
          },
        ],
        provenance: prov({ label: '1 source', sources: 1 }),
      }),
    );
    expect(screen.getAllByTestId('chat-citation-chip')).toHaveLength(1);
  });
  it('a non-grounded reply shows its label, imessage via, no chips; students get no row', () => {
    bubble(
      msg({
        text: 'Hello',
        provenance: prov({
          kind: 'demo',
          label: 'Demo: scripted, not Gemini',
          sources: 0,
          mode: 'demo',
          via: 'imessage',
        }),
      }),
    );
    expect(screen.queryByTestId('chat-citation-chip')).toBeNull();
    expect(screen.getByTestId('chat-provenance-via').textContent).toBe('via iMessage');
    cleanup();
    bubble(msg({ sender: { kind: 'student', id: 's_ana', name: 'Ana' } }));
    expect(screen.queryByTestId('chat-provenance')).toBeNull();
  });
});

describe('PlanChatCard', () => {
  const stub = (generator: ReturnType<typeof planView>['generator']) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(planView({ generator, rationale: 'Because.' })), {
            status: 200,
          }),
      ),
    );
  const show = () =>
    render(<PlanChatCard hub={{ hubUrl: 'http://h', token: 't' }} planId="pl_abcdefghij" />);
  it.each([
    [{ mode: 'live', source: 'planner', note: '', kind: 'agent' }, 'live', 'Live', 'Planner agent'],
    [
      { mode: 'degraded', source: 'fallback', note: '', kind: 'fallback', reason: 'no key' },
      'degraded',
      'Degraded: no key',
      'Fallback sample plan',
    ],
    [
      { mode: 'demo', source: 'scripted', note: '', kind: 'fallback' },
      'demo',
      'Demo: sample data, scripted',
      'Fallback sample plan',
    ],
  ] as const)('badge %#', async (g, mode, label, kind) => {
    stub(g as never);
    show();
    const b = await screen.findByTestId('plan-mode-badge');
    expect(b.getAttribute('data-mode')).toBe(mode);
    expect(b.textContent).toBe(label);
    expect(screen.getByTestId('plan-kind').textContent).toBe(kind);
    expect(screen.getByTestId('plan-rationale').textContent).toBe('Because.');
    expect(screen.getByTestId('plan-sources').textContent).toContain('2 sources');
  });
});
