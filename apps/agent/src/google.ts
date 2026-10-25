// Google Calendar freeBusy (later ticket). Interface only: needs an OAuth token we do not ship.
import type { PrivateProfile } from '@squad/mesh';

export interface FreeBusyOptions {
  accessToken?: string;
  from: string;
  to: string;
  fetch?: typeof fetch;
}

/** Returns busy intervals (titles are not exposed by freeBusy: they are set to "busy"). */
export async function fetchFreeBusy(o: FreeBusyOptions): Promise<PrivateProfile['calendar']> {
  const token = o.accessToken ?? process.env.GOOGLE_ACCESS_TOKEN;
  if (!token)
    throw new Error(
      'Google Calendar is not configured: set GOOGLE_ACCESS_TOKEN (OAuth) or use the .ics import',
    );
  const res = await (o.fetch ?? fetch)('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: o.from, timeMax: o.to, items: [{ id: 'primary' }] }),
  });
  if (!res.ok) throw new Error(`freeBusy failed: HTTP ${res.status}`);
  const j = (await res.json()) as {
    calendars?: { primary?: { busy?: { start: string; end: string }[] } };
  };
  return (j.calendars?.primary?.busy ?? []).map((b) => ({
    start: b.start,
    end: b.end,
    title: 'busy',
  }));
}
