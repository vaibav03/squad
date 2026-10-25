import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { COUNCIL_CONFIDENCE_WORDS, councilVerdictText, type CouncilResult } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { noteCouncilResult } from '../overlays/inspector/bridge';
import { ModeBadge } from './board/ModeBadge';
import { resultMode } from './board/mode-of';
import { ResultBoardButton } from './RunStrip';
import { MessageBlock } from './parts';
import { useChatCardActions } from './card-actions';
import { councilTruthOf, noteCouncilTruth } from './truth-store';

/** The first one or two sentences: the outcome, not the essay. */
export function summarize(text: string, max = 240): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  let out = '';
  for (const s of parts.slice(0, 2)) {
    if ((out + s).length > max && out) break;
    out += s;
  }
  out = out.trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

const sourcesOf = (r: CouncilResult) => {
  const seen = new Set<string>();
  const out: { file: string; page: number; label: string }[] = [];
  for (const m of r.members)
    for (const c of m.citations) {
      const k = `${c.file}#${c.page}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ file: c.file, page: c.page, label: c.label });
    }
  return out;
};

/**
 * THE canonical council answer in chat. Compact: summary, sources, dissent, next action, members collapsed. Height is
 * constrained (see .sqc-card) with an internal "Show full verdict". Its accessible text is the plain verdict.
 */
export function ChatCouncilCard({
  result,
  hub,
  calm,
  onRetry,
}: {
  result: CouncilResult;
  hub?: HubCtx | null;
  calm?: boolean;
  onRetry?: () => void;
}) {
  const actions = useChatCardActions();
  const [full, setFull] = useState(false);
  const [members, setMembers] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const membersId = useId();
  const v = result.verdict;
  const stopped = result.status === 'refused' || result.status === 'failed';
  const mode = resultMode(result);
  useEffect(() => noteCouncilResult(result), [result]);
  useEffect(() => noteCouncilTruth(result.id, councilTruthOf(result)), [result]);
  const sources = useMemo(() => sourcesOf(result), [result]);
  const plain = useMemo(() => councilVerdictText(result), [result]);

  useEffect(() => {
    const e = bodyRef.current;
    if (e) setOverflow(e.scrollHeight > e.clientHeight + 4 || full);
  }, [result, members, full]);

  return (
    <article
      className="sqc-card sqc-card--council"
      data-card="council"
      data-testid="council-chat-card"
      data-mode={mode.split(':')[0]}
      data-expanded={full || undefined}
      aria-label="Council answer"
    >
      <header className="sqc-card__head">
        <span className="sqc-card__title">Council verdict</span>
        <ModeBadge mode={mode} />
        {overflow || full ? (
          <button
            type="button"
            className="sqc-card__more"
            data-testid="council-show-full"
            aria-expanded={full}
            onClick={() => setFull((f) => !f)}
          >
            {full ? 'Collapse' : 'Show full verdict'}
          </button>
        ) : null}
      </header>
      <div className="sqc-card__body" ref={bodyRef} data-clamped={!full || undefined}>
        <p className="sq-sr-only">{plain}</p>
        {stopped ? (
          <MessageBlock result={result} {...(onRetry ? { onRetry } : {})} />
        ) : !v ? (
          <p className="sqc-card__dim" role="status">
            The council is still thinking.
          </p>
        ) : (
          <>
            <section className="sqc-card__sec" aria-labelledby={`${membersId}-s`}>
              <h4 id={`${membersId}-s`} className="sqc-card__h">
                Summary
              </h4>
              <p className="sqc-card__summary" data-testid="council-summary">
                {full ? v.text : summarize(v.text)}
              </p>
              <p className="sqc-card__dim">
                {COUNCIL_CONFIDENCE_WORDS[v.confidence]}
                {v.confidenceNote ? `. ${v.confidenceNote}` : ''}
              </p>
            </section>
            {sources.length ? (
              <section className="sqc-card__sec" aria-label="Sources">
                <h4 className="sqc-card__h">Sources</h4>
                <div className="sqc-sources" role="group" aria-label="Sources">
                  {sources.map((c, i) => (
                    <button
                      key={`${c.file}-${c.page}`}
                      type="button"
                      className="sqc-cite"
                      data-testid="chat-citation-chip"
                      onClick={() => actions?.cite(c)}
                    >
                      <span className="sqc-cite__n" aria-hidden="true">
                        {i + 1}
                      </span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {v.dissent ? (
              <section className="sqc-card__sec" aria-label="Dissent" data-testid="council-dissent">
                <h4 className="sqc-card__h">Dissent</h4>
                <p>
                  <strong>{v.dissent.member}</strong>: {v.dissent.view}
                  {v.dissent.why ? <span className="sqc-card__dim"> Why: {v.dissent.why}</span> : null}
                </p>
              </section>
            ) : null}
            <section className="sqc-card__sec" aria-label="Next action">
              <h4 className="sqc-card__h">Next action</h4>
              <p>{v.next}</p>
              <div className="sqc-card__cta" role="group" aria-label="Next actions">
                <button
                  type="button"
                  className="sqc-btn"
                  data-testid="council-add-plan"
                  onClick={() => actions?.fill(`@cubbie add to my study plan: ${v.next}`)}
                >
                  Add to plan
                </button>
                <button
                  type="button"
                  className="sqc-btn"
                  data-testid="council-follow-up"
                  onClick={() => actions?.fill('@cubbie ask the council: ')}
                >
                  Ask follow-up
                </button>
                <ResultBoardButton result={result} hub={hub ?? null} {...(calm ? { calm } : {})} />
              </div>
            </section>
          </>
        )}
        {result.members.length ? (
          <section className="sqc-card__sec" aria-label="Members">
            <button
              type="button"
              className="sqc-card__toggle"
              data-testid="council-members-toggle"
              aria-expanded={members}
              aria-controls={membersId}
              onClick={() => setMembers((o) => !o)}
            >
              {members ? 'Hide member responses' : `Member responses (${result.members.length})`}
            </button>
            <ul id={membersId} className="sqc-members" hidden={!members}>
              {result.members.map((m) => (
                <MemberRow key={m.id} m={m} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function MemberRow({ m }: { m: CouncilResult['members'][number] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const failed = m.status === 'failed' || !m.text.trim();
  return (
    <li className="sqc-member" data-member={m.id} data-testid="council-member-row">
      <button
        type="button"
        className="sqc-member__row"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sqc-crest" data-member={m.id} aria-hidden="true" />
        <span className="sqc-member__name">{m.name}</span>
        <span className="sqc-member__stance">
          {failed ? 'did not answer this time' : m.answer || m.stance}
        </span>
      </button>
      <div id={id} className="sqc-member__full" hidden={!open}>
        {open ? <p>{failed ? `${m.name} did not answer this time.` : m.text}</p> : null}
      </div>
    </li>
  );
}
