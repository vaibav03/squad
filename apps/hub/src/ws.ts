import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { TTS_NOTICES } from '@squad/core';
import { z } from 'zod';
import { verifyToken } from './auth';
import { callSessions, connectedCalls, hangUp } from './call-sessions';
import type { CallTurn } from './ports';
import type { ActiveCall, HubDeps } from './types';

export interface CallLimits {
  idleMs: number;
  hardMs: number;
}
const DEFAULT_LIMITS: CallLimits = { idleMs: 5 * 60_000, hardMs: 20 * 60_000 };
const MAX_FRAME = 256 * 1024;
const ClientMsg = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user.text'), text: z.string().min(1).max(2000) }),
  z.strictObject({ type: z.literal('mute'), muted: z.boolean() }),
  z.strictObject({ type: z.literal('audio.end') }),
  z.strictObject({ type: z.literal('end') }),
]);
type EndReason = 'client' | 'agent' | 'timeout' | 'server';

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Attach the call websocket (/v1/call/ws/:callId) to the node http server. Returns a closer. */
export function attachCallWs(
  server: Server,
  deps: HubDeps,
  limits: Partial<CallLimits> = {},
): { close(): Promise<void> } {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const live = new Map<string, (r: EndReason) => Promise<void>>();

  function run(ws: WebSocket, call: ActiveCall): void {
    const { callId, agent } = call;
    const session = callSessions.get(callId);
    let ended = false;
    let seq = 0;
    let idle: ReturnType<typeof setTimeout>;
    let queue: Promise<void> = Promise.resolve();
    const send = (o: unknown): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o));
    };

    const end = async (reason: EndReason): Promise<void> => {
      if (ended) return;
      ended = true;
      clearTimeout(idle);
      clearTimeout(hard);
      live.delete(callId);
      await hangUp(deps, callId);
      send({ type: 'ended', reason });
      if (ws.readyState === ws.OPEN) ws.close(1000);
    };
    live.set(callId, end);
    connectedCalls.add(callId);
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => void end('timeout'), lim.idleMs);
      idle.unref?.();
    };
    const hard = setTimeout(() => void end('timeout'), lim.hardMs);
    hard.unref?.();
    bump();

    const speak = async (turns: AsyncIterable<CallTurn>) => {
      for await (const t of turns) {
        if (ended) return;
        send({
          type: 'caption',
          seq: ++seq,
          speaker: 'agent',
          text: t.text,
          ...(t.cite ? { cite: t.cite } : {}),
        });
        deps.ingest.village({
          t: 'call.caption',
          agent,
          callId,
          text: t.text,
          ...(t.cite ? { cite: t.cite } : {}),
        });
        if (t.audio)
          send({
            type: 'audio',
            seq: ++seq,
            mime: t.audio.mime,
            base64: Buffer.from(t.audio.data).toString('base64'),
          });
      }
      // a scripted agent (oral examiner) that has finished: hang up once its captions went out
      if (!ended && session?.finished?.()) await end('server');
    };

    send({ type: 'ready', callId, agent });
    // Captions-only calls say why (the caller shows `message`), instead of silently having no audio.
    const voice = deps.runtime?.ttsStatus?.();
    if (voice && voice.tts === 'none' && !voice.probing && voice.reason !== 'ok')
      send({
        type: 'notice',
        code: 'voices_unavailable',
        reason: voice.reason,
        message: TTS_NOTICES[voice.reason],
      });
    if (!session) return void end('server');
    queue = speak(session.greeting()).catch(() => send({ type: 'error', code: 'agent_failed' }));

    ws.on('message', (data: RawData, isBinary: boolean) => {
      bump();
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
        if (buf.length > MAX_FRAME || !session?.audio)
          return void send({ type: 'error', code: 'audio_unsupported' });
        session.audio(new Uint8Array(buf));
        return;
      }
      let msg: z.infer<typeof ClientMsg>;
      try {
        msg = ClientMsg.parse(JSON.parse(data.toString()));
      } catch {
        return void send({ type: 'error', code: 'invalid_message' });
      }
      if (msg.type === 'end') return void end('client');
      if (msg.type === 'audio.end' || (msg.type === 'mute' && msg.muted)) {
        // end of a mic turn: transcribe what was buffered and answer; no-op for sessions without audio support
        const turn = session.replyToAudio?.bind(session);
        if (turn)
          queue = queue
            .then(() => speak(turn()))
            .catch(() => void send({ type: 'error', code: 'agent_failed' }));
        else if (msg.type === 'audio.end') send({ type: 'error', code: 'audio_unsupported' });
        return;
      }
      if (msg.type === 'user.text') {
        const text = msg.text;
        send({ type: 'caption', seq: ++seq, speaker: 'you', text });
        queue = queue
          .then(() => speak(session.reply(text)))
          .catch(() => void send({ type: 'error', code: 'agent_failed' }));
      }
    });
    ws.on('close', () => void end('client'));
    ws.on('error', () => void end('client'));
  }

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://hub');
    const m = /^\/v1\/call\/ws\/([\w-]+)$/.exec(url.pathname);
    if (!m) return; // not ours: leave to other upgrade listeners
    const callId = m[1] as string;
    const claim = verifyToken(
      deps.config.authSecret,
      url.searchParams.get('st') ?? undefined,
      ['call'],
      deps.now(),
    );
    if (!claim) return reject(socket, 401, 'Unauthorized');
    const call = deps.calls.get(callId);
    if (!call || claim.call !== callId || claim.sub !== call.student)
      return reject(socket, 403, 'Forbidden');
    if (live.has(callId)) return reject(socket, 409, 'Conflict');
    wss.handleUpgrade(req, socket, head, (ws) => run(ws, call));
  };
  server.on('upgrade', onUpgrade);

  return {
    async close() {
      server.off('upgrade', onUpgrade);
      await Promise.all([...live.values()].map((end) => end('server')));
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
