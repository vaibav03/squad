import type { SquadSession } from './types';

/**
 * Hub student ids are `s_<name>` (seeded demo students) or `u_<hex>` (real accounts); the sign-in stub's picker uses the
 * bare name. Only a bare name gets the `s_` prefix: prefixing a `u_` id made the viewer a stranger to their own messages.
 */
export const hubStudentId = (id: string): string => (/^[su]_/.test(id) ? id : `s_${id}`);

/**
 * Signs a seeded student in through the hub's dev-login stub (`POST /v1/auth/dev-login`) and returns the session with
 * the real bearer token. Throws a short, user-safe Error (never the token or the response body) on failure.
 */
export async function devLogin(
  hubUrl: string,
  student: { id: string; name: string; avatarUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SquadSession> {
  let res: Response;
  try {
    res = await fetchImpl(`${hubUrl.replace(/\/+$/, '')}/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: hubStudentId(student.id) }),
    });
  } catch {
    throw new Error('The hub is not reachable.');
  }
  if (!res.ok)
    throw new Error(
      res.status === 404
        ? 'The hub does not know that student.'
        : `Sign-in failed (${res.status}).`,
    );
  const body = (await res.json().catch(() => null)) as {
    token?: unknown;
    student?: { id?: unknown; name?: unknown };
  } | null;
  if (typeof body?.token !== 'string' || !body.token) throw new Error('The hub sent no session.');
  return {
    userId: typeof body.student?.id === 'string' ? body.student.id : hubStudentId(student.id),
    name: typeof body.student?.name === 'string' ? body.student.name : student.name,
    token: body.token,
    avatarUrl: student.avatarUrl,
    live: true,
  };
}
