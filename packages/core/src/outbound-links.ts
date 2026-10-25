// Outbound chat text (iMessage, Discord): links must be absolute and plain. A bot reply may carry a relative app link,
// often as markdown ("[Connections](/squad/connections)"), which a phone cannot open. `absolutizeLinks` turns every
// link into plain text with an absolute URL built from the configured public web URL; with no public URL it keeps the
// page name and drops the link, so the reader is never given a path that goes nowhere.

const PAGE_NAMES: [RegExp, string][] = [
  [/^\/squad\/connections\b/, 'the Connections page'],
  [/^\/squad\/trips?\b/, 'the Trip page'],
  [/^\/squad\/courses?\b/, 'the Courses page'],
  [/^\/squad\/village\b/, 'the Village'],
  [/^\/squad\/plan\b/, 'the Plan page'],
  [/^\/squad\?council=/, 'the Council board'],
  [/^\/squad\?m=/, 'the squad chat'],
];

/** The page a relative app path points at, in words ("the Connections page"). */
export function pageNameOf(path: string): string {
  for (const [re, name] of PAGE_NAMES) if (re.test(path)) return name;
  return 'Squad';
}

/** A usable absolute http(s) origin without trailing slashes, or null. */
export function publicWebBase(url: string | null | undefined): string | null {
  const u = (url ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(u) ? u : null;
}

const MD_LINK = /\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)/g;
// a bare relative app path in running text: /squad, /squad/x/y, /squad?council=cn_x
const BARE_APP_PATH = /(^|[\s(:])(\/squad(?:\/[A-Za-z0-9_\-./]*)?(?:\?[A-Za-z0-9_=&%.-]*)?)/g;
const TRAIL = /[.,;:!?)]+$/;

function absolute(base: string | null, path: string): string | null {
  if (/^https?:\/\//i.test(path)) return path;
  if (!base || !path.startsWith('/')) return null;
  return `${base}${path}`;
}

/**
 * Plain text with absolute links. Markdown links become `label url`; relative app paths get the configured web base,
 * or (no base) the page name. Never throws, never leaves `](`.
 */
export function absolutizeLinks(text: string, webUrl?: string | null): string {
  const base = publicWebBase(webUrl);
  let out = text.replace(MD_LINK, (_m, label: string, href: string) => {
    const url = absolute(base, href);
    if (url) return `${label} ${url}`;
    // no public URL (or a non-path href): keep the words, drop the link
    return label;
  });
  out = out.replace(BARE_APP_PATH, (_m, lead: string, path: string) => {
    const trail = TRAIL.exec(path)?.[0] ?? '';
    const core = trail ? path.slice(0, -trail.length) : path;
    const url = absolute(base, core);
    return `${lead}${url ?? pageNameOf(core)}${trail}`;
  });
  return out;
}
