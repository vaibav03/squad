import { createHash, createHmac } from 'node:crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Content hash used for dedupe: whitespace-insensitive, case-sensitive. */
export const contentHash = (text: string): string => sha256(text.replace(/\s+/g, ' ').trim());

/** Stable id for a source: the same upstream item always maps to the same id for the same owner. */
export const sourceIdFor = (ownerId: string, provider: string, externalId: string): string =>
  `src_${sha256(`${ownerId}\u0000${provider}\u0000${externalId}`).slice(0, 24)}`;

export const chunkIdFor = (sourceId: string, anchor: string): string => `${sourceId}:${anchor}`;

/** Salted (HMAC) hash of an external account identifier; the raw email/id never reaches storage or logs. */
export const hashExternalAccount = (pepper: string, provider: string, accountId: string): string =>
  createHmac('sha256', pepper)
    .update(`${provider}\u0000${accountId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
