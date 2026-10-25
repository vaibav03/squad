import type { Page } from '@playwright/test';
import { api, apiLogin, chatMerged, blocked, note, type Actor } from './helpers';

export const GROUP = 'group:sq_demo';
export const botMsgs = (page: Page) => page.locator('[data-testid="chat-message"][data-sender-id="cubbie"]');

/** Skip as blocked when the chat feature is not on the stack under test. */
export async function needChat(): Promise<void> {
  if (!(await chatMerged())) blocked('not merged yet: chat/web');
}
export async function needRoute(route: string, branch: string): Promise<void> {
  const r = await api(await apiLogin('s_ana'), route);
  if (r.status === 404) blocked(`not merged yet: ${branch}`);
}

export async function openChat(a: Actor, chatId: string): Promise<void> {
  const { page } = a;
  await page.goto('/squad/chat');
  await page.locator('[data-testid="chat-list"],[data-testid="chat-thread"]').first().waitFor({ timeout: 20_000 });
  const row = page.getByTestId(`chat-row-${chatId}`);
  if (await row.count()) await row.click();
  await page.getByTestId('chat-composer-input').waitFor({ timeout: 10_000 });
}
export async function say(page: Page, text: string): Promise<void> {
  const box = page.getByTestId('chat-composer-input');
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}
/** Send over the API (used for quick plants and for flows the UI does not drive). */
export async function sendApi(token: string, chatId: string, text: string, attachments?: { id: string }[]) {
  const r = await api(token, '/v1/chat/send', { method: 'POST', json: { chatId, text, ...(attachments ? { attachments } : {}) } });
  return r;
}
export interface HMsg {
  id: string;
  seq: number;
  chatId: string;
  sender: { kind: string; id?: string; name: string };
  text: string;
  private: boolean;
  attachments: { id: string; kind: string; mime: string; name?: string; bytes?: number; url: string }[];
  citations: { file: string; page: number; label: string }[];
  card?: { type: string; [k: string]: unknown };
  demo: boolean;
}
export async function history(token: string, chatId: string): Promise<HMsg[]> {
  const r = await api(token, `/v1/chat/history?chatId=${encodeURIComponent(chatId)}&limit=100`);
  if (!r.ok) return [];
  return ((await r.json()) as { messages: HMsg[] }).messages;
}
export const isBot = (m: HMsg) => m.sender.kind === 'persona';
/** Poll history until a bot message after `afterCount` bot messages satisfies `pred`. */
export async function waitBot(token: string, chatId: string, pred: (m: HMsg) => boolean, ms = 40_000): Promise<HMsg | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = (await history(token, chatId)).filter(isBot).reverse().find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 800));
  }
  return undefined;
}
export async function botCount(token: string, chatId: string) {
  return (await history(token, chatId)).filter(isBot).length;
}
export const dump = (m: unknown) => JSON.stringify(m).slice(0, 600);
export { note };

/** Minimal valid PNG (w x h, solid grey) built in-process. */
import zlib from 'node:zlib';
export function makePng(w = 64, h = 64, shade = 200): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
