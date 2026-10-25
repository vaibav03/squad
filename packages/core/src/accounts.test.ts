import { describe, expect, it } from 'vitest';
import {
  AuthStartBodySchema,
  InviteCreateBodySchema,
  SquadCreateBodySchema,
  SquadPatchBodySchema,
  SessionResponseSchema,
  formatInviteCode,
  isInviteCode,
  maskContact,
  normalizeEmail,
  normalizePhone,
  parseInviteInput,
} from './accounts';

describe('contact normalisation', () => {
  it('normalizes phones to +digits', () => {
    expect(normalizePhone('(415) 555-0134')).toBe('+14155550134');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('1 415 555 0134')).toBe('+14155550134');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('normalizes emails', () => {
    expect(normalizeEmail('  Maya@Example.COM ')).toBe('maya@example.com');
    expect(normalizeEmail('nope')).toBeNull();
  });
  it('masks without exposing the contact', () => {
    expect(maskContact('phone', '+14155550134')).toBe('•••• 0134');
    expect(maskContact('email', 'maya@example.com')).not.toContain('maya');
  });
});

describe('invite codes', () => {
  it('formats, validates and parses links', () => {
    expect(formatInviteCode('abcd2345')).toBe('ABCD-2345');
    expect(isInviteCode('ABCD-2345')).toBe(true);
    expect(isInviteCode('ABCD-2340')).toBe(false); // 0 is not in the alphabet
    expect(parseInviteInput('https://squad.app/join/abcd-2345')).toBe('ABCD2345');
    expect(parseInviteInput('abcd 2345')).toBe('ABCD2345');
    expect(parseInviteInput('hello')).toBeNull();
  });
});

describe('schemas', () => {
  it('start requires exactly one contact and rejects unknown keys', () => {
    expect(AuthStartBodySchema.safeParse({ name: 'Maya', phone: '4155550134' }).success).toBe(true);
    expect(AuthStartBodySchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(AuthStartBodySchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(AuthStartBodySchema.safeParse({ phone: '1', email: 'a@b.co' }).success).toBe(false);
    expect(AuthStartBodySchema.safeParse({ phone: '4155550134', admin: true }).success).toBe(false);
    expect(AuthStartBodySchema.safeParse({ name: '<b>', phone: '4155550134' }).success).toBe(false);
  });
  it('squad bodies are bounded', () => {
    expect(
      SquadCreateBodySchema.safeParse({ name: 'Bio 101 crew', course: 'BIO 101' }).success,
    ).toBe(true);
    expect(SquadCreateBodySchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(SquadPatchBodySchema.safeParse({}).success).toBe(false);
    expect(SquadPatchBodySchema.safeParse({ course: null }).success).toBe(true);
  });
  it('invite bodies are bounded', () => {
    expect(InviteCreateBodySchema.safeParse({ maxUses: 1, expiresInHours: 24 }).success).toBe(true);
    expect(InviteCreateBodySchema.safeParse({ maxUses: 0 }).success).toBe(false);
    expect(InviteCreateBodySchema.safeParse({ expiresInHours: 5000 }).success).toBe(false);
  });
  it('session response round-trips', () => {
    const ok = SessionResponseSchema.safeParse({
      token: 't',
      expiresAt: 1,
      user: { id: 'u_1', name: 'Maya', contactHint: null, createdAt: 1 },
      squads: [
        { id: 'sq_1', name: 'A', course: null, role: 'owner', memberCount: null, active: true },
      ],
      activeSquadId: 'sq_1',
    });
    expect(ok.success).toBe(true);
  });
});
