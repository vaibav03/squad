import { useState } from 'react';
import { ASK_FIXTURE, modeInfo, playCouncilFixture } from '@squad/village/council';
import { openBoard, useBoardStoreRef } from '../../../council/board/bridge';
import { councilErrorCopy } from '../../../council/council-client';
import { useCouncilHub } from '../../../council/last-run/hub';
import { agoWords, useLastRunsState } from '../../../council/last-run/store';
import { chooseStartTransport, DEFAULT_CONVENE_QUESTION, defaultUseLive, startCouncilRun } from '../../../council/start-run';
import { useCouncilStatus } from '../../../council/status/useCouncilStatus';

/**
 * Under 'No messages involving <name> yet': when no council ever ran, a primary 'Convene the council' button (a real run
 * with a hub, the labelled scripted sample without one); otherwise the persisted last run as 'Last council: 4 min ago, Live'.
 */
export function NoRunNote({ now = Date.now() }: { now?: number }) {
  const hub = useCouncilHub();
  const { status } = useCouncilStatus(hub);
  const stored = useLastRunsState();
  const board = useBoardStoreRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = stored.runs[0];
  if (last)
    return (
      <p className="af-dim" data-testid="af-last-run">
        Last council: {agoWords(last.startedAt, now)}, {modeInfo(last.mode).word}
      </p>
    );
  const convene = async () => {
    setErr(null);
    if (!hub) {
      if (board) playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
      return;
    }
    setBusy(true);
    try {
      await startCouncilRun({
        hub,
        question: DEFAULT_CONVENE_QUESTION,
        transport: chooseStartTransport(status, defaultUseLive(status)),
      });
      openBoard();
    } catch (e) {
      setErr(councilErrorCopy(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="af-convene">
      <p className="af-dim">
        {hub
          ? 'No council has met yet.'
          : 'No council has met yet. Without a hub this plays a scripted sample, labelled DEMO.'}
      </p>
      <button
        type="button"
        className="lv-btn lv-btn--primary"
        data-testid="af-convene"
        disabled={busy}
        onClick={() => void convene()}
      >
        {busy ? 'Convening...' : 'Convene the council'}
      </button>
      {err ? (
        <p className="af-err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
