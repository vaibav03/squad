// Fixture-mode Sendblue for e2e (E2E_SENDBLUE=1): the hub runs IMESSAGE_PROVIDER=sendblue against a FAKE Sendblue
// server on its own port. The values below are throwaway test sentinels, not credentials; nothing real is contacted.
export const SB_FAKE_PORT = Number(process.env.E2E_SENDBLUE_PORT ?? 9071);
export const SB_KEY = 'e2e-sendblue-key';
export const SB_SECRET = 'e2e-sendblue-secret';
export const SB_API_SECRET_FOR_FAKE = SB_SECRET;
export const SB_WEBHOOK_SECRET = 'e2e-sendblue-webhook-secret';
export const SB_LINE = '+15550100000';
export const SB_GROUP = 'e2e-grp-1';
export const SB_ANA = '+15550100001';
export const SB_BEN = '+15550100002';

export const sendblueStackEnv = (): NodeJS.ProcessEnv => ({
  IMESSAGE_PROVIDER: 'sendblue',
  IMESSAGE_ENABLED: '1',
  IMESSAGE_DRY_RUN: '0',
  IMESSAGE_ALLOWED_CHATS: `Sendblue;+;${SB_GROUP}`,
  IMESSAGE_ALLOWED_HANDLES: [SB_ANA, SB_BEN].join(','),
  IMESSAGE_RATE_PER_MIN: '120',
  SENDBLUE_API_KEY: SB_KEY,
  SENDBLUE_API_SECRET: SB_SECRET,
  SENDBLUE_FROM_NUMBER: SB_LINE,
  SENDBLUE_WEBHOOK_SECRET: SB_WEBHOOK_SECRET,
  SENDBLUE_API_BASE: `http://127.0.0.1:${SB_FAKE_PORT}`,
});

import type { Actor } from './helpers';
import { openChat } from './chat';

/** The first-run chat gate ("connect your learning context") is skipped, as a student who chose "Skip for now" would. */
export async function openChatPastGate(a: Actor, chatId: string): Promise<void> {
  await a.page.goto('/squad/chat');
  const skip = a.page.getByRole('button', { name: 'Skip for now' });
  await a.page
    .locator('[data-testid="chat-list"],[data-testid="chat-thread"],[data-testid="context-gate"]')
    .first()
    .waitFor({ timeout: 25_000 });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await a.page.getByRole('button', { name: 'Skip anyway' }).click();
  }
  await openChat(a, chatId);
}
