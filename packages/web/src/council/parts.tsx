import { useEffect, useId, useRef, useState, type Ref } from 'react';
import {
  COUNCIL_CONFIDENCE_WORDS,
  councilVerdictText,
  type CouncilMemberResult,
  type CouncilRanking,
  type CouncilResult,
} from '@squad/core';
import { LvIcon, type LvIconName } from '../overlays/kit/icons';
import { rankingText } from './pacer';
import './council.css';

/** The three seats at the table, in speaking order. Used for the "is thinking" placeholders. */
export const COUNCIL_ROSTER = [
  { id: 'skeptic', name: 'Skeptic' },
  { id: 'teacher', name: 'Teacher' },
  { id: 'practitioner', name: 'Practitioner' },
] as const;

export const claimsDropped = (n: number) =>
  `${n} ${n === 1 ? 'claim' : 'claims'} dropped: no verified quote`;

export function MemberCard({ m }: { m: CouncilMemberResult }) {
  const failed = m.status === 'failed' || !m.text.trim();
  return (
    <article className="cn-member" data-member={m.id} data-failed={failed || undefined}>
      <header className="cn-member__head">
        <span className="cn-member__name">{m.name}</span>
        <span className="cn-member__stance">{m.stance}</span>
      </header>
      {failed ? (
        <p className="cn-member__text cn-dim">{m.name} did not answer this time.</p>
      ) : (
        <>
          <p className="cn-member__text">{m.text}</p>
          {m.answer && (
            <p className="cn-member__answer">
              <span className="cn-eyebrow">Answer</span>
              {m.answer}
            </p>
          )}
        </>
      )}
      {m.citations.length > 0 && (
        <ul className="cn-cites" aria-label={`${m.name}'s verified sources`}>
          {m.citations.map((c) => (
            <li key={`${c.file}:${c.page}`} className="cn-cite" title={c.label}>
              <LvIcon name="file" size={12} />
              {c.file} p.{c.page}
            </li>
          ))}
        </ul>
      )}
      {m.struck > 0 && (
        <p className="cn-struck">
          <LvIcon name="info" size={14} />
          {claimsDropped(m.struck)}
        </p>
      )}
    </article>
  );
}

export function MemberSkeleton({ name, id }: { name: string; id?: string }) {
  return (
    <li className="cn-member cn-member--wait" data-member={id}>
      <span className="cn-member__name">{name}</span>
      <p className="cn-wait">{name} is thinking...</p>
      <span className="cn-skel" style={{ width: '92%' }} aria-hidden="true" />
      <span className="cn-skel" style={{ width: '68%' }} aria-hidden="true" />
    </li>
  );
}

export function RankingBlock({ rankings }: { rankings: readonly CouncilRanking[] }) {
  const id = useId();
  return (
    <section className="cn-rank" data-step="rankings" aria-labelledby={id}>
      <h3 id={id} className="cn-h3">
        <LvIcon name="vote" size={16} />
        Ranking
      </h3>
      <p className="cn-dim cn-small">Each member put the other answers in order, best first.</p>
      <ul>
        {rankings.map((r) => (
          <li key={r.member}>{rankingText(r)}</li>
        ))}
      </ul>
    </section>
  );
}

const CONF_ICON: Record<string, LvIconName> = {
  confident: 'check',
  fairly_sure: 'shield',
  uncertain: 'alert',
};

export function CopyVerdictButton({ result }: { result: CouncilResult }) {
  const areaId = useId();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const area = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const text = councilVerdictText(result);

  const done = () => {
    setState('copied');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2200);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      return done();
    } catch {
      /* blocked: try the old path, then show the text to copy by hand */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return done();
    } catch {
      /* fall through */
    }
    setState('manual');
  };
  useEffect(() => {
    if (state === 'manual') {
      area.current?.focus();
      area.current?.select();
    }
  }, [state]);

  return (
    <div className="cn-copy">
      <button
        type="button"
        className="lv-btn"
        onClick={() => void copy()}
        data-copied={state === 'copied' || undefined}
      >
        <LvIcon name={state === 'copied' ? 'check' : 'file'} size={16} />
        {state === 'copied' ? 'Copied' : 'Copy verdict'}
      </button>
      <span className="lv-vh" role="status">
        {state === 'copied' ? 'Verdict copied to the clipboard.' : ''}
      </span>
      {state === 'manual' && (
        <div className="cn-copy__manual">
          <label htmlFor={areaId} className="cn-small cn-dim">
            Copying is blocked here. Select the text and copy it yourself.
          </label>
          <textarea
            id={areaId}
            ref={area}
            readOnly
            rows={4}
            value={text}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}

export function VerdictBlock({
  result,
  headingRef,
}: {
  result: CouncilResult;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const v = result.verdict;
  if (!v) return null;
  const level = v.confidence;
  return (
    <section
      className="cn-verdict"
      data-step="verdict"
      data-uncertain={v.uncertain || undefined}
      aria-label="Verdict"
    >
      <div className="cn-verdict__tag">
        <span className="cn-pixel" aria-hidden="true">
          Verdict
        </span>
        {result.demo && (
          <span className="cn-badge" data-kind="demo" title="Sample answers, not from a live model">
            <LvIcon name="info" size={12} />
            Demo mode
          </span>
        )}
      </div>
      <h3 className="cn-verdict__text" tabIndex={-1} ref={headingRef}>
        <span className="lv-vh">Verdict: </span>
        {v.text}
      </h3>

      <div className="cn-conf" data-level={level}>
        <span className="cn-conf__word">
          <LvIcon name={CONF_ICON[level] ?? 'info'} size={16} />
          {COUNCIL_CONFIDENCE_WORDS[level]}
        </span>
        <span className="cn-conf__note">{v.confidenceNote}</span>
      </div>

      {v.dissent && (
        <aside className="cn-dissent" aria-label={`Dissent from ${v.dissent.member}`}>
          <p className="cn-dissent__tag">
            <LvIcon name="split" size={14} />
            Dissent from {v.dissent.member}
          </p>
          <p className="cn-dissent__view">{v.dissent.view}</p>
          {v.dissent.why && (
            <p className="cn-dissent__why">
              <span className="cn-eyebrow">Why</span>
              {v.dissent.why}
            </p>
          )}
        </aside>
      )}

      <div className="cn-next">
        <h4 className="cn-h4">What to do next</h4>
        <p>{v.next}</p>
      </div>

      {result.notes.length > 0 && (
        <ul className="cn-notes" aria-label="Notes">
          {result.notes.map((n) => (
            <li key={n}>
              <LvIcon name="info" size={14} />
              {n}
            </li>
          ))}
        </ul>
      )}

      <CopyVerdictButton result={result} />
    </section>
  );
}

/** Message block for refused and failed runs. */
export function MessageBlock({ result, onRetry }: { result: CouncilResult; onRetry?: () => void }) {
  const refused = result.status === 'refused';
  return (
    <div
      className="cn-block"
      data-kind={refused ? 'refused' : 'failed'}
      role={refused ? 'status' : 'alert'}
    >
      <p>
        <LvIcon name={refused ? 'lock' : 'alert'} size={18} />
        <span>
          <strong>
            {refused ? 'The council will not answer this one' : 'The council could not finish'}
          </strong>
          <br />
          {result.message ??
            (refused ? 'Try asking about the ideas instead.' : 'Nothing was lost. Try again.')}
        </span>
      </p>
      {!refused && onRetry && (
        <button type="button" className="lv-btn" onClick={onRetry}>
          <LvIcon name="refresh" size={16} />
          Try again
        </button>
      )}
    </div>
  );
}

export function ErrorBlock({
  message,
  offline,
  onRetry,
}: {
  message: string;
  offline?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="cn-block" data-kind={offline ? 'offline' : 'error'} role="alert">
      <p>
        <LvIcon name={offline ? 'wifi-off' : 'alert'} size={18} />
        <span>
          <strong>{offline ? 'No connection' : 'Something went wrong'}</strong>
          <br />
          {message}
        </span>
      </p>
      {onRetry && (
        <button type="button" className="lv-btn" onClick={onRetry}>
          <LvIcon name="refresh" size={16} />
          Try again
        </button>
      )}
    </div>
  );
}
