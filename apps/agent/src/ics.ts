// Minimal .ics import (shared parser lives in @squad/core). Google freeBusy is a later ticket (src/google.ts).
import { parseIcsBusy } from '@squad/core';
import type { PrivateProfile } from '@squad/mesh';

type Ev = PrivateProfile['calendar'][number];

export function parseIcs(text: string): Ev[] {
  return parseIcsBusy(text);
}

export function importIcs(profile: PrivateProfile, ics: string): PrivateProfile {
  return { ...profile, calendar: parseIcs(ics) };
}
