// The Sendblue provider, behind the SAME transport interface as the local Mac bridge (`IMessageSdkLike`), so the
// gateway (kill switch, allowlists, dry run, rate limit, echo/flood guards), the bridge and the sync queue run
// unchanged. Inbound arrives by webhook (`deliverInbound`), not by a watcher; sends are Sendblue REST calls.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { inboundAllowed, type IMessageConfig, type IMessageSdkLike, type Logger } from '@squad/bot';
import type { SendblueClient } from './client';
import { SendblueError } from './client';
import { redact, type SendblueConfig } from './config';
import { newSendId, signStatusToken } from './status-token';
import type { MediaSigner } from './media';
import type { SbMessage } from './webhook-schema';

export const GROUP_PREFIX = 'Sendblue;+;';
export const DM_PREFIX = 'Sendblue;-;';
const E164 = /^\+\d{7,15}$/;
const MEDIA_MAX = 9 * 1024 * 1024;

export const groupGuid = (groupId: string) => `${GROUP_PREFIX}${groupId}`;
export const groupIdOf = (guid: string): string | undefined =>
  guid.startsWith(GROUP_PREFIX) ? guid.slice(GROUP_PREFIX.length) : undefined;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

const privateHost = (h: string): boolean =>
  /^(localhost|.*\.local|.*\.internal)$/i.test(h) ||
  /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
  /^\[?(::1|fc|fd|fe80)/i.test(h);

/** Inbound `media_url` is attacker-influenced data from a webhook: https only, no private hosts. */
export function mediaUrlOk(
  raw: string,
  cfg: Pick<SendblueConfig, 'mediaHosts' | 'loopback'>,
): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (cfg.loopback && (host === '127.0.0.1' || host === 'localhost') && u.protocol === 'http:')
    return true; // fixture mode only: the fake Sendblue CDN
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (privateHost(host)) return false;
  return (
    cfg.mediaHosts.length === 0 || cfg.mediaHosts.some((s) => host === s || host.endsWith(`.${s}`))
  );
}

export interface SendblueSdkOptions {
  cfg: SendblueConfig;
  client: SendblueClient;
  media: MediaSigner;
  /** The gateway safety config: allowlists decide whether an inbound attachment is fetched at all. */
  safety: IMessageConfig;
  log: Logger;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface SendblueSdk extends IMessageSdkLike {
  /** A verified, deduped inbound webhook message, fed to the gateway. */
  deliverInbound(m: SbMessage): Promise<void>;
  /** A status callback, as a gateway receipt. */
  receipt(guid: string, state: 'sent' | 'delivered' | 'read' | 'failed', reason?: string): void;
  readonly watching: boolean;
  /** The Sendblue message handle a status-callback send id produced (undefined if unknown / not yet recorded). */
  statusHandleFor(sendId: string): string | undefined;
}

export function createSendblueSdk(o: SendblueSdkOptions): SendblueSdk {
  const { cfg, client, media, log } = o;
  const fetchFn = o.fetchFn ?? fetch;
  let events: Parameters<IMessageSdkLike['startWatching']>[0] = {};
  let watching = false;
  let receiptCb: Parameters<NonNullable<IMessageSdkLike['watchReceipts']>>[0] | undefined;
  const sendHandles = new Map<string, string>();
  const statusUrl = () => {
    if (!cfg.publicUrl || !(cfg.publicUrl.startsWith('https://') || cfg.loopback)) return undefined;
    const sendId = newSendId();
    const t = signStatusToken(cfg.webhookSecret, sendId, Date.now());
    return { sendId, url: `${cfg.publicUrl}/v1/webhooks/sendblue/status?t=${t}` };
  };

  async function fetchMedia(url: string): Promise<{ path: string; dir: string } | undefined> {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!res.ok) return undefined;
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > MEDIA_MAX) return undefined;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MEDIA_MAX) return undefined;
      const dir = mkdtempSync(join(tmpdir(), 'sb-in-'));
      const ext =
        extname(new URL(url).pathname)
          .slice(0, 6)
          .replace(/[^.\w]/g, '') || '.bin';
      const path = join(dir, `f${ext}`);
      writeFileSync(path, buf);
      return { path, dir };
    } catch {
      return undefined; // the placeholder path: "file is unavailable"
    }
  }

  const target = (to: string): { group: string } | { number: string } => {
    const g = groupIdOf(to);
    if (g) return { group: g };
    const n = to.startsWith(DM_PREFIX) ? to.slice(DM_PREFIX.length) : to;
    if (!E164.test(n)) throw new SendblueError('not an E.164 number', 400, 'bad_target');
    return { number: n };
  };

  const sdk: SendblueSdk = {
    get watching() {
      return watching;
    },
    async startWatching(e) {
      events = e;
      watching = true;
    },
    async stopWatching() {
      watching = false;
    },
    async close() {
      watching = false;
    },
    async listChats() {
      return [];
    },
    async send(r) {
      const t = target(r.to);
      const paths = r.attachments ?? [];
      const urls = paths.map((p) => {
        const u = media.urlFor(p, cfg.publicUrl);
        if (!u || !cfg.publicUrl)
          throw new SendblueError('attachment cannot be sent', 400, 'bad_media');
        return u;
      });
      // Sendblue takes one media_url per message: text rides with the first, each further file is its own send
      const sends: { content: string; mediaUrl?: string }[] = urls.length
        ? urls.map((u, i) => ({ content: i === 0 ? (r.text ?? '') : '', mediaUrl: u }))
        : [{ content: r.text ?? '' }];
      let first: string | undefined;
      for (const s of sends) {
        const sc = statusUrl();
        const cb = sc?.url;
        const res =
          'group' in t
            ? await client.sendGroupMessage({
                groupId: t.group,
                ...s,
                ...(cb ? { statusCallback: cb } : {}),
              })
            : await client.sendMessage({
                number: t.number,
                ...s,
                ...(cb ? { statusCallback: cb } : {}),
              });
        if (sc) {
          sendHandles.set(sc.sendId, res.handle);
          if (sendHandles.size > 1000) sendHandles.delete(sendHandles.keys().next().value as string);
        }
        first ??= res.handle;
      }
      return { guid: first as string };
    },
    statusHandleFor(sendId) {
      return sendHandles.get(sendId);
    },
    watchReceipts(cb) {
      receiptCb = cb;
    },
    receipt(guid, state, reason) {
      receiptCb?.({ guid, state, ...(reason ? { reason } : {}) });
    },
    async deliverInbound(m) {
      if (!watching) return;
      const group = !!m.group_id;
      const chatId = group ? groupGuid(m.group_id!) : `${DM_PREFIX}${m.from_number}`;
      const sender = m.from_number ?? '';
      let tmp: { path: string; dir: string } | undefined;
      const attachments: { localPath: string | null; mimeType: string; fileName?: string }[] = [];
      if (m.media_url) {
        const ext = extname(safePath(m.media_url)).slice(1).toLowerCase();
        const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
        // only for an allowlisted chat/number, and only a public https URL
        if (inboundAllowed(o.safety, { chatId, sender, group }) && mediaUrlOk(m.media_url, cfg))
          tmp = await fetchMedia(m.media_url);
        attachments.push({ localPath: tmp?.path ?? null, mimeType: mime });
      }
      try {
        await events.onIncomingMessage?.({
          id: m.message_handle,
          chatId,
          chatKind: group ? 'group' : 'dm',
          participant: sender,
          text: m.content ?? '',
          kind: 'text',
          isFromMe: false,
          createdAt: new Date(Date.parse(m.date_sent ?? '') || Date.now()),
          attachments,
        });
      } catch (e) {
        log.error({ err: redact((e as Error).name, cfg) }, 'sendblue inbound handler failed');
        throw e;
      } finally {
        if (tmp) rmSync(tmp.dir, { recursive: true, force: true });
      }
    },
  };
  return sdk;
}

function safePath(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return '';
  }
}
