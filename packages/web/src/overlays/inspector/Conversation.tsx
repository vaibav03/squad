import {
  relTime,
  type ActivityView,
  type Conversation,
  type InspectorStore,
  type Party,
  type ThreadLine,
  type VoiceView,
} from '@squad/village/inspector';
import { CitationChip } from '../../components/source-viewer';
import { LvIcon } from '../kit';
import { useDmHistory, type InspectorHub } from './useDmHistory';
import { RoomChat, VoiceChat } from './RoomChat';

const ARROW = { out: '→', in: '←', seen: '↔' } as const;
const KIND_WORDS: Record<string, string> = {
  council: 'Council answer',
  rank: 'Anonymous ranking',
  verdict: 'Verdict',
  mesh: 'Plan task',
  privacy: 'Privacy gate',
  quiz: 'Quiz',
  call: 'Call',
  confirm: 'Confirm',
  trip: 'Trip',
  discussion: 'Discussion',
  other: 'Message',
};

function PartyChip({ p, store }: { p: Party; store: InspectorStore }) {
  const selectable = p.id !== 'commons' && p.id !== 'everyone' && store.has(p.id);
  if (!selectable) return <span className="ai-party">{p.label}</span>;
  return (
    <button type="button" className="ai-party ai-party--btn" onClick={() => store.select(p.id)}>
      {p.label}
    </button>
  );
}

function ThreadItem({ l, store, now }: { l: ThreadLine; store: InspectorStore; now: number }) {
  return (
    <li
      className="ai-msg"
      data-dir={l.direction}
      data-dissent={l.dissent || undefined}
      data-alert={l.alert || undefined}
    >
      <div className="ai-msg__head">
        <PartyChip p={l.from} store={store} />
        <span
          className="ai-arrow"
          aria-label={
            l.direction === 'out'
              ? 'said to'
              : l.direction === 'in'
                ? 'said to this agent, from'
                : 'with'
          }
        >
          {ARROW[l.direction]}
        </span>
        <PartyChip p={l.to} store={store} />
        <time>{relTime(l.at, now)}</time>
      </div>
      <p className="ai-msg__text">{l.text}</p>
      <div className="ai-msg__meta">
        <span className="ai-kind">{KIND_WORDS[l.kind] ?? 'Message'}</span>
        {l.dissent && (
          <span className="ai-flag">
            <LvIcon name="alert" size={12} aria-hidden="true" /> Dissent recorded
          </span>
        )}
        {l.cite && (
          <CitationChip
            citation={{
              file: l.cite.file,
              page: l.cite.page ?? 1,
              ...(l.cite.quote ? { quote: l.cite.quote } : {}),
              courseId: l.cite.courseId,
            }}
          />
        )}
      </div>
    </li>
  );
}

/** Talking to agents: who this agent is exchanging messages with now, and the live thread. */
export function AgentsTab({
  view,
  convo,
  store,
  now,
}: {
  view: ActivityView;
  convo: Conversation;
  store: InspectorStore;
  now: number;
}) {
  return (
    <div className="ai-tabpanel">
      <section aria-label="Talking to">
        <h3 className="ai-label">Talking to</h3>
        {convo.partners.length === 0 ? (
          <p className="ai-empty">Not exchanging messages with anyone right now.</p>
        ) : (
          <ul className="ai-partners">
            {convo.partners.map((p) => (
              <li key={p.id + p.label} data-active={p.active || undefined}>
                <span className="ai-line" aria-hidden="true" />
                {p.selectable && store.has(p.id) ? (
                  <button
                    type="button"
                    className="ai-party ai-party--btn"
                    onClick={() => store.select(p.id)}
                  >
                    {p.label}
                  </button>
                ) : (
                  <span className="ai-party">{p.label}</span>
                )}
                <span className="ai-count">
                  {p.count} {p.count === 1 ? 'message' : 'messages'}
                  {p.active ? ', talking now' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Agent thread">
        <h3 className="ai-label">Thread</h3>
        {convo.thread.length === 0 ? (
          <p className="ai-empty">
            {view.isMe ? 'Your study agent has' : `${view.name} has`} not exchanged anything with
            other agents yet. Agents trade typed messages, not free chat; this fills in live.
          </p>
        ) : (
          <ol className="ai-thread">
            {convo.thread.map((l) => (
              <ThreadItem key={l.seq} l={l} store={store} now={now} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Chat: what this agent and the viewer said to each other. Other students' chats are never shown. */
export function ChatTab({
  view,
  convo,
  hub,
  now,
  mode,
  room,
  voice,
}: {
  view: ActivityView;
  convo: Conversation;
  hub?: InspectorHub | null;
  now: number;
  mode: 'live' | 'replay';
  /** Set when the inspector was opened from a character inside a room. */
  room?: { slot: string; who: string } | null;
  /** Set for council agents: the member's (or the whole council's) thread. */
  voice?: { view: VoiceView; title: string } | null;
}) {
  const own = view.isMe && mode === 'live';
  const dm = useDmHistory(hub, own ? storeStudent(view.id) : undefined, own);
  const private_ = view.kind === 'student' && !view.isMe;
  if (voice)
    return (
      <div className="ai-tabpanel">
        <VoiceChat voice={voice.view} title={voice.title} now={now} />
      </div>
    );
  if (room)
    return (
      <div className="ai-tabpanel">
        <RoomChat slot={room.slot} who={room.who} agentName={view.name} now={now} />
      </div>
    );
  return (
    <div className="ai-tabpanel">
      {private_ ? (
        <p className="ai-privacy">
          <LvIcon name="lock" size={14} aria-hidden="true" /> {view.name}&rsquo;s chats are private
          to them. Only their public activity shows here.
        </p>
      ) : (
        <>
          {own && (
            <section aria-label="Your chat with your agent">
              <h3 className="ai-label">Your chat</h3>
              {dm.state === 'error' && (
                <p className="ai-empty">The chat could not load. It will retry.</p>
              )}
              {dm.state !== 'error' && dm.messages.length === 0 && (
                <p className="ai-empty">
                  {dm.state === 'loading' ? 'Loading your chat…' : 'No messages yet.'}
                </p>
              )}
              <ol className="ai-chat">
                {[...dm.messages].reverse().map((m) => (
                  <li
                    key={m.id}
                    className="ai-bub"
                    data-who={m.sender.kind === 'student' ? 'you' : 'agent'}
                  >
                    <div className="ai-bub__head">
                      <b>{m.sender.kind === 'student' ? 'You' : m.sender.name}</b>
                      <time>{relTime(m.ts, now)}</time>
                    </div>
                    <p>{m.text}</p>
                    {m.citations.length > 0 && (
                      <div className="ai-msg__meta">
                        {m.citations.map((c, i) => (
                          <CitationChip key={i} citation={{ file: c.file, page: c.page }} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section aria-label="Exchanges with you">
            <h3 className="ai-label">{own ? 'In the village' : `You and ${view.name}`}</h3>
            {convo.chat.length === 0 ? (
              <p className="ai-empty">
                {own
                  ? 'Questions, quizzes and confirms with you show up here.'
                  : `Nothing said between you and ${view.name} yet. Start a call or answer a quiz question.`}
              </p>
            ) : (
              <ol className="ai-chat">
                {convo.chat.map((l) => (
                  <li key={l.seq} className="ai-bub" data-who={l.who}>
                    <div className="ai-bub__head">
                      <b>{l.name}</b>
                      <time>{relTime(l.at, now)}</time>
                    </div>
                    <p>{l.text}</p>
                    {l.cite && (
                      <div className="ai-msg__meta">
                        <CitationChip
                          citation={{
                            file: l.cite.file,
                            page: l.cite.page ?? 1,
                            ...(l.cite.quote ? { quote: l.cite.quote } : {}),
                            courseId: l.cite.courseId,
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
const storeStudent = (id: string): string | undefined =>
  id.startsWith('student:') ? id.slice(8) : undefined;
