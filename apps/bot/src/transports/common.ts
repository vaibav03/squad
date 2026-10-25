import type { Student, StudentId } from '@squad/core';
import type { Roster } from '../types';

/** Normalize a phone/email handle for matching: lowercase email, digits-only phone (last 10 digits). */
export function normalizeHandle(h: string): string {
  const t = h.trim().toLowerCase();
  if (t.includes('@')) return t;
  const d = t.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Roster lookup; unknown senders become `s_<last4>` so a new number never crashes the bot. */
export function resolveStudent(roster: Roster, handle: string): StudentId {
  const n = normalizeHandle(handle);
  const hit = roster.students.find((s) => normalizeHandle(s.handle) === n);
  if (hit) return hit.id;
  const digits = n.replace(/\D/g, '');
  return `s_${digits.slice(-4) || n.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'anon'}`;
}

export function studentById(roster: Roster, id: StudentId): Student | undefined {
  return roster.students.find((s) => s.id === id);
}

/** Serialises sends and spaces them at least `minGapMs` apart (default 1000 = 1 msg/s). */
export class SendLimiter {
  private tail: Promise<void> = Promise.resolve();
  private last = 0;
  constructor(
    private readonly minGapMs = 1000,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(async () => {
      const wait = this.last + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        return await fn();
      } finally {
        this.last = this.now();
      }
    });
    this.tail = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}
