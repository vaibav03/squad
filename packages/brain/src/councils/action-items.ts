import { COUNCIL_ACTIONS_MAX, recordCouncilAction, type CouncilAction } from '@squad/core';
import type { AgentRun } from '../agents/runtime';
import type { AgentId } from '@squad/core';

const cut = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}.`;

/**
 * The shared action-items convention (docs/a2a.md): one `status` envelope per item, stage `actions`, from the chair to
 * the room, summary = the title (<= 120), parent = the verdict, source `code`. At most COUNCIL_ACTIONS_MAX. Each item is
 * also recorded by run id so the hub's `actions/plan|chat` endpoints work for runs that are not CouncilService runs.
 */
export async function publishActionTitles(
  R: AgentRun,
  chairId: AgentId,
  titles: string[],
  parentMessageId: string | undefined,
): Promise<CouncilAction[]> {
  const out: CouncilAction[] = [];
  for (const raw of [...new Set(titles.map((t) => t.trim()).filter(Boolean))].slice(
    0,
    COUNCIL_ACTIONS_MAX,
  )) {
    const title = cut(raw, 120);
    try {
      const m = await R.publishCode({
        from: chairId,
        to: 'room',
        kind: 'status',
        stage: 'actions',
        summary: title,
        ...(parentMessageId ? { parentMessageId } : {}),
      });
      recordCouncilAction(m.correlationId, { id: m.id, title });
      out.push({ id: m.id, title });
    } catch {
      // an action item that cannot be published is skipped; the verdict stands
    }
  }
  return out;
}
