import { useState } from 'react';
import { relTime, voiceName, type VoiceLine, type VoiceView } from '@squad/village/inspector';
import { roomInfo, saidBy, seatLabel } from '@squad/village/rooms';
import type { TranscriptEntry, TranscriptKind } from '@squad/village/rooms';
import { CitationChip } from '../../components/source-viewer';
import { LvIcon } from '../kit';
import { speakerName } from '../room-info/names';
import { useRoomSnapshot } from './useRoomSession';

const KIND: Record<TranscriptKind, string> = {
  opinion: 'Council opinion',
  rank: 'Anonymous rank',
  verdict: 'Chair verdict',
  caption: 'On the call',
  question: 'Question',
  note: 'Note',
};

const nameOf = (who: string): string => (who.includes(':') ? speakerName(who) : seatLabel(who));

/**
 * Everything said in the room the viewer is inside, in order, with the clicked character's lines
 * marked. Words come from the room session (public words only, already privacy-filtered by the
 * hub stream and the scenes module). One click on any character reads the whole discussion.
 */
export function RoomChat({
  slot,
  who,
  agentName,
  now,
}: {
  slot: string;
  who: string;
  agentName: string;
  now: number;
}) {
  const snap = useRoomSnapshot();
  const [only, setOnly] = useState(false);
  const all: readonly TranscriptEntry[] = snap.transcripts[slot] ?? [];
  const mine = all.filter((e) => saidBy(who, e));
  const shown = only ? mine : all;
  const title = roomInfo(slot)?.title ?? 'this room';
  return (
    <section aria-label="Room chat" className="ai-roomchat">
      <h3 className="ai-label">Room chat: {title}</h3>
      <div className="ai-seg" role="group" aria-label="Which lines to show">
        <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
          Room chat ({all.length})
        </button>
        <button type="button" aria-pressed={only} onClick={() => setOnly(true)}>
          Just {agentName} ({mine.length})
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="ai-empty">
          {all.length === 0
            ? 'Nobody has said anything in this room yet. It fills in live.'
            : `${agentName} has not said anything yet.`}
        </p>
      ) : (
        <ol className="ai-thread" aria-live="polite" aria-relevant="additions">
          {shown.map((e) => (
            <li
              key={e.id}
              className="ai-msg"
              data-dissent={e.dissent || undefined}
              data-focus={saidBy(who, e) || undefined}
            >
              <div className="ai-msg__head">
                <b className="ai-party">{nameOf(e.who)}</b>
                {e.ts ? <time>{relTime(e.ts, now)}</time> : null}
              </div>
              <p className="ai-msg__text">{e.text}</p>
              <div className="ai-msg__meta">
                <span className="ai-kind">{KIND[e.kind]}</span>
                {e.dissent && (
                  <span className="ai-flag">
                    <LvIcon name="alert" size={12} aria-hidden="true" /> Dissent recorded
                  </span>
                )}
                {e.cite && (
                  <CitationChip
                    citation={{
                      file: e.cite.file,
                      page: e.cite.page ?? 1,
                      ...(e.cite.quote ? { quote: e.cite.quote } : {}),
                      courseId: e.cite.courseId,
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const VOICE_KIND: Record<VoiceLine['kind'], string> = {
  opinion: 'Council opinion',
  rank: 'Anonymous rank',
  verdict: 'Chair verdict',
  turn: 'Said at the table',
  yield: 'Yielded',
  thought: 'Shared thought',
};

/**
 * A council agent's chat: the whole room thread (their lines and the replies from the other members, in order)
 * with a `Just <name>` switch. Words come from `council.*` / `discussion.*` events and from council results the
 * panel handed in; public words only.
 */
export function VoiceChat({ voice, title, now }: { voice: VoiceView; title: string; now: number }) {
  const [only, setOnly] = useState(false);
  const all = voice.thread;
  const mine = voice.said;
  const mineSeq = new Set(mine.map((l) => l.seq));
  const shown = only ? mine : all;
  const single = voice.who !== '';
  return (
    <section aria-label="Room chat" className="ai-roomchat" data-testid="voice-chat">
      <h3 className="ai-label">Room chat: {title}</h3>
      {single && (
        <div className="ai-seg" role="group" aria-label="Which lines to show">
          <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
            Room chat ({all.length})
          </button>
          <button type="button" aria-pressed={only} onClick={() => setOnly(true)}>
            Just {voice.name} ({mine.length})
          </button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="ai-empty">
          {all.length === 0
            ? 'Nobody has said anything here yet. It fills in live.'
            : `${voice.name} has not said anything yet.`}
        </p>
      ) : (
        <ol className="ai-thread" aria-live="polite" aria-relevant="additions">
          {shown.map((l) => (
            <li
              key={l.seq}
              className="ai-msg"
              data-dissent={l.dissent || undefined}
              data-focus={mineSeq.has(l.seq) || undefined}
            >
              <div className="ai-msg__head">
                <b className="ai-party">{voiceName(l.who)}</b>
                {l.to && <span className="ai-arrow">to {voiceName(l.to)}</span>}
                <time>{relTime(l.at, now)}</time>
              </div>
              <p className="ai-msg__text">{l.text}</p>
              <div className="ai-msg__meta">
                <span className="ai-kind">{VOICE_KIND[l.kind]}</span>
                {l.dissent && (
                  <span className="ai-flag">
                    <LvIcon name="alert" size={12} aria-hidden="true" /> Dissent recorded
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
