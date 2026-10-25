import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CouncilResult } from '@squad/core';
import { councilErrorCopy, councilErrorKind, type CouncilTransport } from './council-client';
import { announceCouncilStarted } from './stage/room-opener';
import { createPacer, type Pacer, type PacerView } from './pacer';

export type RunStatus = 'idle' | 'running' | 'finished' | 'error' | 'offline';

export interface CouncilRun {
  status: RunStatus;
  /** Latest snapshot from the hub (may be ahead of what the pacer has revealed). */
  result: CouncilResult | null;
  /** What the pacer has put on screen. */
  view: PacerView;
  /** Fixed user-safe copy for `error` and `offline`. */
  error: string | null;
  question: string;
  ask(question: string, chatId?: string): void;
  /** Re-send the last question (after an error or offline) or re-load the last run. */
  retry(): void;
  skip(): void;
  reset(): void;
}

const EMPTY: PacerView = { members: 0, rankings: false, verdict: false, settled: false };

/** Drives one council run: ask, stream snapshots through the pacer, fall back to a plain GET if the stream breaks. */
export function useCouncilRun(transport: CouncilTransport | null): CouncilRun {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<CouncilResult | null>(null);
  const [view, setView] = useState<PacerView>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const pacer = useRef<Pacer | null>(null);
  const closeStream = useRef<(() => void) | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gen = useRef(0);
  const last = useRef<{ question: string; chatId?: string; runId?: string } | null>(null);
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const teardown = useCallback(() => {
    gen.current++;
    closeStream.current?.();
    closeStream.current = null;
    clearTimeout(poll.current);
    pacer.current?.dispose();
    pacer.current = null;
  }, []);
  useEffect(() => teardown, [teardown]);

  const fail = useCallback((e: unknown) => {
    setError(councilErrorCopy(e));
    setStatus(councilErrorKind(e) === 'offline' ? 'offline' : 'error');
  }, []);

  const begin = useCallback(
    (q: string, chatId?: string) => {
      const t = transportRef.current;
      teardown();
      const mine = gen.current;
      const alive = () => gen.current === mine;
      last.current = { question: q, ...(chatId ? { chatId } : {}) };
      setQuestion(q);
      setResult(null);
      setView(EMPTY);
      setError(null);
      if (!t) {
        fail(new Error('no hub'));
        return;
      }
      setStatus('running');
      const p = createPacer();
      pacer.current = p;
      p.subscribe((v) => alive() && setView(v));
      const push = (r: CouncilResult) => {
        if (!alive()) return;
        setResult(r);
        p.push(r);
        if (r.status !== 'running') {
          setStatus('finished');
          closeStream.current?.();
          closeStream.current = null;
        }
      };
      void (async () => {
        try {
          const resp = await t.ask(q, chatId);
          if (!alive()) return;
          last.current = { ...last.current!, runId: resp.id };
          if (resp.status === 'running') announceCouncilStarted({ id: resp.id, councilKey: 'ask' });
          if (resp.status !== 'running') {
            push(await t.get(resp.id));
            return;
          }
          // The stream broke: read the run directly, and keep reading while it is still going.
          const recover = async (n = 0): Promise<void> => {
            try {
              const r = await t.get(resp.id);
              if (!alive()) return;
              push(r);
              if (r.status === 'running' && n < 80)
                poll.current = setTimeout(() => void recover(n + 1), 1500);
            } catch (e) {
              if (alive()) fail(e);
            }
          };
          closeStream.current = t.stream(resp, {
            onStep: push,
            onDone: () => void recover(),
            onError: () => void recover(),
          });
        } catch (e) {
          if (alive()) fail(e);
        }
      })();
    },
    [fail, teardown],
  );

  const retry = useCallback(() => {
    const l = last.current;
    if (!l) return;
    // A broken load of a known run only needs the result again; a failed ask is re-sent.
    if (l.runId && transportRef.current) {
      const t = transportRef.current;
      const mine = gen.current;
      setError(null);
      setStatus('running');
      t.get(l.runId).then(
        (r) => {
          if (gen.current !== mine) return;
          setResult(r);
          pacer.current?.push(r);
          setStatus(r.status === 'running' ? 'running' : 'finished');
        },
        (e) => gen.current === mine && fail(e),
      );
      return;
    }
    begin(l.question, l.chatId);
  }, [begin, fail]);

  const skip = useCallback(() => pacer.current?.skip(), []);
  const reset = useCallback(() => {
    teardown();
    last.current = null;
    setStatus('idle');
    setResult(null);
    setView(EMPTY);
    setError(null);
    setQuestion('');
  }, [teardown]);

  return useMemo(
    () => ({ status, result, view, error, question, ask: begin, retry, skip, reset }),
    [status, result, view, error, question, begin, retry, skip, reset],
  );
}
