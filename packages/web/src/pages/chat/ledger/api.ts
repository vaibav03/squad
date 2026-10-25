import { GroupLedgerResponseSchema, type GroupLedgerEntry } from '@squad/core';
import { timedFetch } from '../../../lib/http';

/** Reads one group's ledger. Rejects with `Error('not_found')` for a group the viewer is not in (hub answers 404). */
export type FetchGroupLedger = (groupId: string) => Promise<GroupLedgerEntry[]>;

export function createGroupLedgerFetcher(cfg: { hubUrl: string; token: string }): FetchGroupLedger {
  return async (groupId) => {
    const res = await timedFetch(`${cfg.hubUrl}/v1/groups/${encodeURIComponent(groupId)}/ledger`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    if (res.status === 404) throw new Error('not_found');
    if (!res.ok) throw new Error(`ledger ${res.status}`);
    return GroupLedgerResponseSchema.parse(await res.json()).entries;
  };
}
