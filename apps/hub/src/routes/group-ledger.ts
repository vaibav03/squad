import type { GroupLedgerEntry, GroupLedgerKind, Plan } from '@squad/core';
import type { HubDeps } from '../types';

/** Plan log text (written by the plan service) to a ledger kind and a plain sentence. */
function planRow(text: string, title: string): { kind: GroupLedgerKind; text: string } {
  if (text === 'plan proposed') return { kind: 'plan_created', text: `created the plan "${title}"` };
  if (text === 'accepted') return { kind: 'vote', text: `accepted "${title}"` };
  if (text === 'declined') return { kind: 'vote', text: `declined "${title}"` };
  if (text.startsWith('confirmed')) return { kind: 'decision', text: `confirmed "${title}"` };
  if (text === 'cancelled') return { kind: 'decision', text: `cancelled "${title}"` };
  if (text.startsWith('plan active')) return { kind: 'decision', text: `activated "${title}" (everyone accepted)` };
  if (text.startsWith('replaced')) return { kind: 'decision', text: `replaced "${title}" with a new plan` };
  if (text.startsWith('picked')) return { kind: 'decision', text: `resolved an edit conflict: ${text}` };
  if (text.startsWith('added ') && /\([^)]+\)$/.test(text))
    return { kind: 'import', text: `${text} from imported material` };
  return { kind: 'edit', text };
}

/** Ledger rows for one squad, newest first. Callers must already have checked the viewer belongs to the squad. */
export function groupLedger(deps: HubDeps, squadId: string): GroupLedgerEntry[] {
  const who = (id: string) => ({ id, name: deps.directory.student(id)?.name ?? id });
  const out: GroupLedgerEntry[] = [];
  for (const p of deps.plans.store.list(squadId) as Plan[]) {
    const src = { kind: 'plan' as const, label: `${p.generator.source || 'Study plan'}: ${p.title}` };
    p.log.forEach((l, i) => {
      const row = planRow(l.text, p.title);
      out.push({
        id: `${p.id}:${i}`,
        ts: l.ts,
        by: who(l.by),
        kind: row.kind,
        text: `${who(l.by).name} ${row.text}`,
        source: src,
        mode: p.generator.mode,
      });
    });
  }
  for (const t of deps.trips.list(squadId)) {
    const c = t.collab;
    if (!c) continue;
    const src = { kind: 'trip' as const, label: `Trip: ${c.title}` };
    const mode = c.recommendation?.mode ?? 'demo';
    out.push({
      id: `${t.tripId}:created`,
      ts: c.createdAt,
      by: who(c.organizer),
      kind: 'plan_created',
      text: `${who(c.organizer).name} started the trip "${c.title}"`,
      source: src,
      mode,
    });
    c.changes.forEach((ch, i) =>
      out.push({
        id: `${t.tripId}:change:${i}`,
        ts: ch.at,
        by: who(ch.by),
        kind: 'edit',
        text: `${who(ch.by).name} ${ch.summary}`,
        source: src,
        mode,
      }),
    );
    for (const v of t.votes)
      out.push({
        id: `${t.tripId}:vote:${v.student}`,
        ts: null,
        by: who(v.student),
        kind: 'vote',
        text: `${who(v.student).name} voted on trip options`,
        source: src,
        mode,
      });
    if (c.chosen)
      out.push({
        id: `${t.tripId}:chosen`,
        ts: c.recommendation?.at ?? null,
        by: who(c.organizer),
        kind: 'decision',
        text: `The group chose ${t.options.find((o) => o.id === c.chosen!.optionId)?.label ?? 'an option'} for "${c.title}"`,
        source: src,
        mode,
      });
  }
  // newest first; rows with no recorded time sink to the bottom
  return out.sort((a, b) => (b.ts ?? -1) - (a.ts ?? -1));
}
