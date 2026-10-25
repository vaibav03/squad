// Accounts and squads contract (docs/accounts-api.md). Browser-safe: zod schemas and pure helpers only.
// Hashing, signing and storage live in apps/hub; this file never touches node: APIs.
import { z } from 'zod';

/** Squads of this many members or more may show counts (mirrors `MIN_GROUP_SIZE` in group-size.ts). */
export const SQUAD_MAX_SIZE_DEFAULT = 12;
export const SQUAD_NAME_MAX = 40;
export const COURSE_NAME_MAX = 60;
export const DISPLAY_NAME_MAX = 40;
export const CODE_LENGTH = 6;
export const SQUAD_ROLES = ['owner', 'member'] as const;
export type SquadRole = (typeof SQUAD_ROLES)[number];

/** Invite codes: 8 chars from an alphabet without 0/O/1/I/L, shown as `ABCD-EFGH`. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 8;

// ---------- contact normalisation ----------
/** E.164-ish: strips spaces, dashes, dots and parentheses; keeps a leading +. Returns null if it cannot be a phone. */
export function normalizePhone(raw: string, defaultCountry = '1'): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

/** Display form that never exposes the full contact: `•••• 4567` or `a•••@example.com`. */
export function maskContact(channel: ContactChannel, normalized: string): string {
  if (channel === 'phone') return `•••• ${normalized.slice(-4)}`;
  const [local = '', domain = ''] = normalized.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function isInviteCode(raw: string): boolean {
  const c = normalizeInviteCode(raw);
  return c.length === INVITE_CODE_LENGTH && [...c].every((ch) => INVITE_ALPHABET.includes(ch));
}
export function formatInviteCode(raw: string): string {
  const c = normalizeInviteCode(raw);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
/** Accepts a bare code or a pasted invite link (`.../join/ABCD-EFGH`, `?code=`), returns the normalized code or null. */
export function parseInviteInput(input: string): string | null {
  const t = input.trim();
  const fromLink = /(?:join\/|code=|invite\/)([A-Za-z0-9-]{8,12})/.exec(t)?.[1];
  const code = normalizeInviteCode(fromLink ?? t);
  return isInviteCode(code) ? code : null;
}

// ---------- schemas ----------
export const ContactChannelSchema = z.enum(['phone', 'email']);
export type ContactChannel = z.infer<typeof ContactChannelSchema>;

const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX)
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f<>]/.test(s), 'invalid characters');

/** `POST /v1/auth/start`. Exactly one of phone / email. `name` is required only for a brand-new account. */
export const AuthStartBodySchema = z
  .object({
    name: NameSchema.optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().min(3).max(254).optional(),
  })
  .strict()
  .refine((b) => (b.phone === undefined) !== (b.email === undefined), {
    message: 'send exactly one of phone or email',
  });
export type AuthStartBody = z.infer<typeof AuthStartBodySchema>;

export const AuthStartResponseSchema = z.object({
  challengeId: z.string(),
  channel: ContactChannelSchema,
  to: z.string(),
  expiresAt: z.number(),
  resendAfter: z.number(),
  /** Only in dev (HUB_DEV_LOGIN=1, not production): the code, so demos and tests need no console. */
  devCode: z.string().optional(),
});
export type AuthStartResponse = z.infer<typeof AuthStartResponseSchema>;

export const AuthVerifyBodySchema = z
  .object({ challengeId: z.string().min(1).max(80), code: z.string().trim().min(4).max(10) })
  .strict();
export type AuthVerifyBody = z.infer<typeof AuthVerifyBodySchema>;

export const AccountUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** `•••• 4567` or `a•••@x.com`; the full contact is never returned. */
  contactHint: z.string().nullable(),
  avatarUrl: z.string().optional(),
  personaId: z.string().optional(),
  createdAt: z.number(),
});
export type AccountUser = z.infer<typeof AccountUserSchema>;

export const SquadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  course: z.string().nullable(),
  role: z.enum(SQUAD_ROLES),
  /** null when the squad has fewer than 3 members (minimum group size rule). */
  memberCount: z.number().nullable(),
  active: z.boolean(),
  demo: z.boolean().optional(),
});
export type SquadSummary = z.infer<typeof SquadSummarySchema>;

export const SessionResponseSchema = z.object({
  /** Bearer for tools. The web app also gets it as an httpOnly cookie and may ignore it. */
  token: z.string(),
  expiresAt: z.number(),
  user: AccountUserSchema,
  squads: z.array(SquadSummarySchema),
  activeSquadId: z.string().nullable(),
  /** true when this verify created the account. */
  created: z.boolean().optional(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const SquadCreateBodySchema = z
  .object({
    name: z.string().trim().min(2).max(SQUAD_NAME_MAX),
    course: z.string().trim().max(COURSE_NAME_MAX).optional(),
  })
  .strict();
export type SquadCreateBody = z.infer<typeof SquadCreateBodySchema>;

export const SquadPatchBodySchema = z
  .object({
    name: z.string().trim().min(2).max(SQUAD_NAME_MAX).optional(),
    course: z.string().trim().max(COURSE_NAME_MAX).nullable().optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.course !== undefined, { message: 'nothing to change' });
export type SquadPatchBody = z.infer<typeof SquadPatchBodySchema>;

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  role: z.enum(SQUAD_ROLES),
  joinedAt: z.number(),
  you: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InviteCreateBodySchema = z
  .object({
    /** 1 = single use; null/omitted = unlimited until expiry. */
    maxUses: z.number().int().min(1).max(100).nullable().optional(),
    /** Hours until expiry (1 to 720). Default 168 (7 days). */
    expiresInHours: z.number().min(1).max(720).optional(),
  })
  .strict();
export type InviteCreateBody = z.infer<typeof InviteCreateBodySchema>;

export const InviteSchema = z.object({
  id: z.string(),
  /** `ABCD-EFGH` */
  code: z.string(),
  /** Full link, built from the web origin the creating client sent, else HUB_WEB_URL. */
  link: z.string(),
  maxUses: z.number().nullable(),
  uses: z.number(),
  expiresAt: z.number(),
  createdAt: z.number(),
  createdBy: z.string(),
  status: z.enum(['active', 'expired', 'revoked', 'used_up']),
});
export type Invite = z.infer<typeof InviteSchema>;

/** `GET /v1/invites/:code` (no auth): enough to show "Join Maya's squad" and nothing sensitive. */
export const InvitePreviewSchema = z.object({
  squadName: z.string(),
  course: z.string().nullable(),
  invitedBy: z.string(),
  /** null under the minimum group size. */
  memberCount: z.number().nullable(),
  full: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const InviteJoinBodySchema = z.object({ code: z.string().trim().min(1).max(200) }).strict();
export type InviteJoinBody = z.infer<typeof InviteJoinBodySchema>;

export const SquadDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  course: z.string().nullable(),
  role: z.enum(SQUAD_ROLES),
  memberCount: z.number().nullable(),
  maxSize: z.number(),
  members: z.array(MemberSchema),
  createdAt: z.number(),
});
export type SquadDetail = z.infer<typeof SquadDetailSchema>;

export const ACCOUNT_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid_request',
  'rate_limited',
  'code_invalid',
  'code_expired',
  'too_many_attempts',
  'invite_invalid',
  'invite_expired',
  'invite_revoked',
  'invite_used_up',
  'squad_full',
  'already_member',
  'last_owner',
  'dev_login_disabled',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];
