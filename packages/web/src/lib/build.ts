import { useEffect, useState } from 'react';
import { timedFetch } from './http';

declare const __SQUAD_BUILD__: BuildInfo | undefined;

export interface BuildInfo {
  /** git short sha (12) of the checkout the web bundle or dev server was started from */
  sha: string;
  /** ISO time the dev server started or the bundle was built */
  builtAt: string;
}

/** Injected by the host's vite `define`; absent (tests, other hosts) it reads "unknown" and never warns. */
export const WEB_BUILD: BuildInfo =
  typeof __SQUAD_BUILD__ !== 'undefined' && __SQUAD_BUILD__
    ? __SQUAD_BUILD__
    : { sha: 'unknown', builtAt: '' };

const known = (s?: string): s is string => Boolean(s) && s !== 'unknown';

/** True when both shas are known and differ (either may be a longer form of the same commit). */
export function isStaleBuild(web?: string, hub?: string): boolean {
  if (!known(web) || !known(hub)) return false;
  const a = web.toLowerCase();
  const b = hub.toLowerCase();
  return !(a.startsWith(b) || b.startsWith(a));
}

export function formatBuiltAt(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export interface HubBuild {
  version?: string;
  gitSha?: string;
  builtAt?: string;
}

/** The hub's /v1/status version and gitSha (public, no auth). Undefined until answered, or when the hub is unreachable. */
export function useHubBuild(hubUrl?: string): HubBuild | undefined {
  const [hub, setHub] = useState<HubBuild | undefined>();
  useEffect(() => {
    if (!hubUrl) return;
    let dead = false;
    const load = async () => {
      try {
        const res = await timedFetch(`${hubUrl.replace(/\/+$/, '')}/v1/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as Record<string, unknown>;
        if (dead) return;
        setHub({
          ...(typeof j.version === 'string' ? { version: j.version } : {}),
          ...(typeof j.gitSha === 'string' ? { gitSha: j.gitSha } : {}),
          ...(typeof j.builtAt === 'string' ? { builtAt: j.builtAt } : {}),
        });
      } catch {
        /* hub down: the connection badge says so; the marker just shows the web build */
      }
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [hubUrl]);
  return hub;
}
