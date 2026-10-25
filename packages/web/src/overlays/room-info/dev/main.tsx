import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import type { VillageEvent } from '@squad/core';
import { createRoomSession, ROOM_INFO } from '@squad/village/rooms';
import '../../../styles/index.css';
import { RoomLayer } from '../RoomLayer';
import { FIXTURE_INFO, FIXTURE_OUTCOME } from '../fixtures';

// ?room=round-table&state=empty|talking|outcome&panel=1|0&w=390&calm=1
const q = new URLSearchParams(location.search);
const room = q.get('room') ?? 'round-table';
const state = q.get('state') ?? 'talking';
const panel = q.get('panel') === '1';
const w = q.get('w');
const calm = q.get('calm') === '1';

const realInfo = (ROOM_INFO as Record<string, typeof FIXTURE_INFO | undefined>)[room];
const infoFor = (slot: string) => (slot === room ? (realInfo ?? FIXTURE_INFO) : undefined);

if (!panel) {
  try {
    sessionStorage.setItem(`squad:room-info-seen:${room}`, '1');
  } catch {
    /* ignore */
  }
}

// ?replay=1 plays events recorded from the real skills (dev/rooms-b-replay.json, written by
// `pnpm --filter @squad/brain exec tsx src/skills/rooms-b.record.script.ts`), keyed by room slot.
const replay = q.get('replay') === '1';

async function playReplay(s: ReturnType<typeof createRoomSession>) {
  const data = (await (await fetch('/rooms-b-replay.json')).json()) as Record<string, VillageEvent[]>;
  s.enter(room);
  for (const e of data[room] ?? []) s.record(room, e, Date.now());
}

function script(s: ReturnType<typeof createRoomSession>) {
  if (replay) return void playReplay(s);
  const say = (member: string, text: string, extra: object = {}) =>
    s.record(room, { t: 'council.opinion', councilId: 'c1', member, text, ...extra }, Date.now());
  s.enter(room);
  if (state === 'empty') return;
  say('chill', 'Five courses is plenty. Leave room for sleep and for a life.');
  say('grind', 'Take eighteen credits and finish a term early.', { dissent: true });
  say('advisor', 'Data Structures has to come first; three later courses depend on it.');
  for (const m of ['chill', 'grind', 'advisor']) {
    s.record(
      room,
      { t: 'council.rank', councilId: 'c1', member: m, order: ['CS 201', 'MATH 210', 'STAT 230'] },
      Date.now(),
    );
  }
  if (state === 'outcome') {
    s.record(
      room,
      {
        t: 'council.verdict',
        councilId: 'c1',
        member: 'chair',
        text: 'Fifteen credits, five courses, steady week.',
        outcome: FIXTURE_OUTCOME,
        dissent: true,
      },
      Date.now(),
    );
  }
}

function App() {
  const session = useMemo(() => createRoomSession({ run: (_s, p) => console.info('run', p) }), []);
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark';
    script(session);
  }, [session]);
  return (
    <div className="stage" style={w ? { width: `${w}px` } : undefined}>
      <div className="hud">
        <span className="chip">Ana</span>
        <span className="chip">Squad 3</span>
        <span className="chip chip--r">Calm</span>
      </div>
      <div className="landmark" aria-hidden="true">
        <i />
        <b>{room}</b>
      </div>
      <RoomLayer session={session} calm={calm} infoFor={infoFor} />
    </div>
  );
}

const style = document.createElement('style');
style.textContent = `
  html,body{margin:0;height:100%;background:#070f1f}
  .stage{position:relative;width:100vw;height:100vh;overflow:hidden;
    background:radial-gradient(60% 40% at 70% 12%,#fff2c433,transparent 60%),linear-gradient(#0b1d38,#0a3a63 55%,#122b3f 56%,#0d3a4f)}
  .hud{position:absolute;top:16px;left:16px;right:16px;display:flex;gap:8px;z-index:10}
  .chip{padding:8px 12px;border-radius:999px;background:#0b1d38c7;border:1px solid #b4d6da2e;color:#eef3f8;font:600 14px Inter,system-ui,sans-serif}
  .chip--r{margin-left:auto}
  .landmark{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:8px;color:#8c9bb8;font:12px ui-monospace}
  .landmark i{width:140px;height:70px;border-radius:50%;background:#7a3552;border:4px solid #3a2634;box-shadow:0 12px 0 #4a2440}
`;
document.head.appendChild(style);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
