/**
 * Shared harness for the accessibility audit (scripts/a11y, apps/web-host/e2e-a11y).
 * Playwright comes from apps/web-host (already a workspace devDependency); axe-core from scripts/a11y/node_modules
 * (installed on demand with npm so no shared package.json is touched).
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const A11Y_DIR = path.join(ROOT, 'scripts/a11y');
const webHostReq = createRequire(path.join(ROOT, 'apps/web-host/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const pw = webHostReq('playwright') as typeof import('playwright');
export type { Page, Browser, BrowserContext } from 'playwright';

export function axeSource(): string {
  const p = path.join(A11Y_DIR, 'node_modules/axe-core/axe.min.js');
  if (!existsSync(p)) {
    execSync('npm install --no-audit --no-fund', { cwd: A11Y_DIR, stdio: 'inherit' });
  }
  return readFileSync(p, 'utf8');
}

export const BASE = process.env.A11Y_BASE_URL ?? 'http://localhost:15911';
export const HUB = process.env.A11Y_HUB_URL ?? 'http://localhost:18911';

export interface Variant {
  w: number;
  h: number;
  theme: 'dark' | 'light';
  calm: boolean;
  reduced: boolean;
  forced?: boolean;
  zoom?: number;
}
export const vname = (v: Variant) =>
  `${v.w}x${v.h}-${v.theme}-${v.calm ? 'calm' : 'full'}-${v.reduced ? 'rm' : 'motion'}${v.forced ? '-forced' : ''}${v.zoom && v.zoom !== 1 ? `-z${v.zoom * 100}` : ''}`;

export const SESSION = { userId: 'ana', name: 'Ana', token: 'dev-ana', avatarUrl: '/avatars/ana.png' };

export async function newPage(browser: import('playwright').Browser, v: Variant) {
  const ctx = await browser.newContext({
    viewport: { width: v.w, height: v.h },
    reducedMotion: v.reduced ? 'reduce' : 'no-preference',
    colorScheme: v.theme,
    forcedColors: v.forced ? 'active' : 'none',
    deviceScaleFactor: 1,
    hasTouch: v.w < 500,
  });
  await ctx.addInitScript(
    ([s, t, calm, hub]) => {
      try {
        localStorage.setItem('squad.session', JSON.stringify(s));
        localStorage.setItem('squad.theme', t as string);
        localStorage.setItem('squad.calm', calm ? '1' : '0');
        void hub;
      } catch {
        /* ignore */
      }
    },
    [SESSION, v.theme, v.calm, HUB] as const,
  );
  const page = await ctx.newPage();
  return { ctx, page };
}

export interface RouteDef {
  id: string;
  url: string;
  /** wait for this selector (or just networkidle) */
  ready?: string;
  village?: boolean;
}

export const ROUTES: RouteDef[] = [
  { id: 'home', url: '/squad' },
  { id: 'village-replay-track2', url: '/squad/village?replay=track2', village: true },
  { id: 'village-replay-track3', url: '/squad/village?replay=track3', village: true },
  { id: 'village-live', url: '/squad/village', village: true },
  { id: 'ledger', url: '/squad/ledger' },
  { id: 'trip', url: '/squad/trips/demo' },
  { id: 'setup', url: '/squad/setup' },
  { id: 'personas', url: '/squad/personas' },
  { id: 'mastery', url: '/squad/mastery' },
  { id: 'gallery', url: '/__gallery' },
  { id: 'labs', url: '/__labs' },
  { id: 'signin', url: '/signin' },
  { id: 'notfound', url: '/nope' },
];

export async function gotoRoute(page: import('playwright').Page, r: RouteDef) {
  await page.goto(BASE + r.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (r.village) {
    await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
  } else await page.waitForTimeout(500);
  await page.evaluate(() => document.fonts.ready);
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; html: string }[];
}

export async function runAxe(page: import('playwright').Page, opts: { selector?: string } = {}): Promise<AxeViolation[]> {
  await page.evaluate(axeSource());
  const res = await page.evaluate(async (sel) => {
    const ax = (window as unknown as { axe: any }).axe; // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await ax.run(sel ? { include: [sel] } : document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
    });
    return r.violations.map((v: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n: any) => ({ target: n.target.map(String), html: String(n.html).slice(0, 200) })), // eslint-disable-line @typescript-eslint/no-explicit-any
    }));
  }, opts.selector);
  return res as AxeViolation[];
}
