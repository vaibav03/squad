import type { HubCtx } from '../../pages/village/hub';

export type ActionKind = 'plan' | 'chat';
export interface ActionOutcome {
  ok: boolean;
  /** Plain words for the status line. Never an error body or a status line. */
  message: string;
}

const FAIL: Record<ActionKind, string> = {
  plan: 'Could not add that to the plan.',
  chat: 'Could not send that to the squad chat.',
};

/**
 * Council action item -> the hub (`POST /v1/council/:id/actions/plan|chat`). The hub looks the item up by id on the
 * run, so only the id travels. Resolves with fixed, user-safe copy and never throws.
 */
export async function postCouncilAction(
  hub: HubCtx,
  runId: string,
  actionId: string,
  kind: ActionKind,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<ActionOutcome> {
  if (!hub.token) return { ok: false, message: FAIL[kind] };
  try {
    const res = await fetchImpl(
      `${hub.hubUrl.replace(/\/+$/, '')}/v1/council/${encodeURIComponent(runId)}/actions/${kind}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${hub.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ actionId }),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      added?: boolean;
      error?: { code?: string; message?: string };
    } | null;
    if (res.ok && body?.ok) {
      if (kind === 'chat') return { ok: true, message: 'Sent to the squad chat.' };
      return {
        ok: true,
        message: body.added === false ? 'Already on the study plan.' : 'Added to the study plan.',
      };
    }
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: 'Your session ended. Sign in again.' };
    if (kind === 'plan' && body?.error?.code === 'no_plan')
      return {
        ok: false,
        message: 'There is no study plan yet. Ask Nook to make one in the chat first.',
      };
    if (kind === 'plan' && res.status === 409)
      return { ok: false, message: 'The study plan is closed, so nothing was added.' };
    return { ok: false, message: FAIL[kind] };
  } catch {
    return { ok: false, message: FAIL[kind] };
  }
}
