// Sendblue provider configuration (docs/sendblue.md). Credentials come ONLY from the environment, are read here and
// nowhere else, and never leave this module except through `redact`.
export type ImessageProvider = 'off' | 'fake' | 'local' | 'sendblue';

/** Env names, in the order the UI and the health page list them. */
export const SENDBLUE_REQUIRED_ENV = [
  'SENDBLUE_API_KEY',
  'SENDBLUE_API_SECRET',
  'SENDBLUE_FROM_NUMBER',
  'SENDBLUE_WEBHOOK_SECRET',
] as const;

export interface SendblueConfig {
  apiKey: string;
  apiSecret: string;
  /** The Sendblue line (E.164). */
  fromNumber: string;
  webhookSecret: string;
  /** Header Sendblue puts the shared secret in. Default `sb-signing-secret`. */
  secretHeader: string;
  apiBase: string;
  /** Public origin of this hub (webhook URL and signed media URLs). */
  publicUrl: string;
  /** Webhooks older than this (by their own timestamp) are replays. */
  replayWindowS: number;
  /** Optional allowlist of media CDN host suffixes (SENDBLUE_MEDIA_HOSTS). */
  mediaHosts: string[];
  /** Fixture mode only: the API base is loopback, so media may be fetched over http from loopback. */
  loopback: boolean;
}

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v ?? '').trim();

export function providerFromEnv(env: Env): ImessageProvider {
  const v = clean(env.IMESSAGE_PROVIDER).toLowerCase();
  if (v === 'sendblue' || v === 'fake' || v === 'local' || v === 'off') return v;
  // unset: the pre-Sendblue behaviour (the local Mac bridge only when IMESSAGE_ENABLED=1), otherwise off
  return clean(env.IMESSAGE_ENABLED) === '1' ? 'local' : 'off';
}

const isLoopback = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch {
    return false;
  }
};

export function sendblueConfigFromEnv(env: Env, fallbackPublicUrl = ''): SendblueConfig {
  const apiBase = (clean(env.SENDBLUE_API_BASE) || 'https://api.sendblue.com').replace(/\/+$/, '');
  const win = Number(env.SENDBLUE_REPLAY_WINDOW_S);
  return {
    // Nook's names (SENDBLUE_API_KEY_ID / SENDBLUE_NUMBER) are accepted as aliases
    apiKey: clean(env.SENDBLUE_API_KEY) || clean(env.SENDBLUE_API_KEY_ID),
    apiSecret: clean(env.SENDBLUE_API_SECRET),
    fromNumber: clean(env.SENDBLUE_FROM_NUMBER) || clean(env.SENDBLUE_NUMBER),
    webhookSecret: clean(env.SENDBLUE_WEBHOOK_SECRET),
    secretHeader: (clean(env.SENDBLUE_WEBHOOK_SECRET_HEADER) || 'sb-signing-secret').toLowerCase(),
    apiBase,
    publicUrl: (clean(env.SENDBLUE_PUBLIC_URL) || fallbackPublicUrl).replace(/\/+$/, ''),
    replayWindowS: Number.isFinite(win) && win > 0 ? win : 24 * 3600,
    mediaHosts: clean(env.SENDBLUE_MEDIA_HOSTS)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    loopback: isLoopback(apiBase),
  };
}

/** The required env names that are unset, in listing order. */
export function missingSendblueEnv(c: SendblueConfig): string[] {
  const have: Record<(typeof SENDBLUE_REQUIRED_ENV)[number], boolean> = {
    SENDBLUE_API_KEY: !!c.apiKey,
    SENDBLUE_API_SECRET: !!c.apiSecret,
    SENDBLUE_FROM_NUMBER: !!c.fromNumber,
    SENDBLUE_WEBHOOK_SECRET: !!c.webhookSecret,
  };
  return SENDBLUE_REQUIRED_ENV.filter((n) => !have[n]);
}

/** Removes every credential value from a string (logs, errors, statuses). */
export function redact(
  text: string,
  c: Pick<SendblueConfig, 'apiKey' | 'apiSecret' | 'webhookSecret'>,
): string {
  let out = text;
  for (const v of [c.apiKey, c.apiSecret, c.webhookSecret])
    if (v && v.length >= 4) out = out.split(v).join('[redacted]');
  return out;
}

/** `+1555•••4567`: enough to recognise a number, never the number. */
export const maskNumber = (n: string): string => {
  const d = n.replace(/\D/g, '');
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '••••';
};
