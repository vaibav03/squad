/** Bearer fallback for the web app. The httpOnly cookie is the source of truth; this only keeps older pages working. */
const TOKEN_KEY = 'squad.token';
const NEXT_KEY = 'squad.next';
let memoryToken: string | null = null;

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}
export function saveToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the in-memory copy still works */
  }
}

/** Only same-origin paths may be used as a return target (no open redirects). */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (raw.startsWith('/welcome')) return null;
  return raw;
}

/** The place to return to after sign-in (for example /join/ABCD-EFGH). Survives a reload of the sign-in flow. */
export function rememberNext(path: string | null): void {
  try {
    if (path && safeNext(path)) sessionStorage.setItem(NEXT_KEY, path);
    else sessionStorage.removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
}
export function recallNext(): string | null {
  try {
    return safeNext(sessionStorage.getItem(NEXT_KEY));
  } catch {
    return null;
  }
}
