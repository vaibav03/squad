import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CouncilResult } from '@squad/core';
import { getCouncil } from '../../council/council-client';
import { Notice } from '../../primitives/Notice';
import { Button } from '../../primitives/Button';
import { useSquadConfig } from '../../shell/context';
import { requestChatPrefill } from './prefill';

/** The sentence put in the composer for a council verdict. Kept short so the group can read it at a glance. */
export function seedText(r: Pick<CouncilResult, 'question' | 'verdict'>, wizard: string | null) {
  const v = r.verdict?.text ?? '';
  const q = r.question.length > 160 ? `${r.question.slice(0, 157)}...` : r.question;
  const what = wizard ? 'Make a plan from' : 'Let us talk about';
  return `${what} the council's verdict on "${q}": ${v}`.slice(0, 900);
}

/**
 * `/squad/chat?seed=<councilRunId>[&wizard=study|trip]`: the council's verdict arrives as a context chip above the chat
 * and as a starting message in the composer, so the discussion (or the plan) begins from the decision, not from nothing.
 */
export function CouncilSeed() {
  const [params, setParams] = useSearchParams();
  const cfg = useSquadConfig();
  const seed = params.get('seed');
  const wizard = params.get('wizard');
  const [run, setRun] = useState<CouncilResult | null>(null);
  const [failed, setFailed] = useState(false);
  const filled = useRef<string | null>(null);
  const hub = useMemo(
    () => (cfg.hubUrl && cfg.token ? { hubUrl: cfg.hubUrl, token: cfg.token } : null),
    [cfg.hubUrl, cfg.token],
  );

  useEffect(() => {
    if (!seed || !hub) return;
    const ac = new AbortController();
    setFailed(false);
    getCouncil(hub, seed, ac.signal).then(
      (r) => !ac.signal.aborted && setRun(r),
      () => !ac.signal.aborted && setFailed(true),
    );
    return () => ac.abort();
  }, [seed, hub]);

  // put the verdict in the composer once, after the chat has mounted
  useEffect(() => {
    if (!seed || !run?.verdict || filled.current === seed) return;
    filled.current = seed;
    const t = setTimeout(() => requestChatPrefill(seedText(run, wizard)), 400);
    return () => clearTimeout(t);
  }, [seed, run, wizard]);

  if (!seed) return null;
  const clear = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('seed');
        return n;
      },
      { replace: true },
    );
  if (failed || (!hub && !run))
    return (
      <div className="sqc-seed" data-testid="chat-seed">
        <Notice tone="warn" onDismiss={clear}>
          We could not load that council decision. You can still ask your question here.
        </Notice>
      </div>
    );
  return (
    <div className="sqc-seed" data-testid="chat-seed">
      <Notice tone="info" onDismiss={clear}>
        {run?.verdict ? (
          <>
            <strong>
              {wizard ? 'Planning from the council decision' : 'Council decision attached'}:
            </strong>{' '}
            {run.verdict.text}{' '}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => requestChatPrefill(seedText(run, wizard))}
            >
              Put it in my message
            </Button>
          </>
        ) : (
          'Loading the council decision...'
        )}
      </Notice>
    </div>
  );
}
