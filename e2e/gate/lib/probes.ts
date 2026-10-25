// "Is this feature on main yet?" A step whose probe fails reports NOT_BUILT(owner), never PASS.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './config';
import type { Probe } from './types';

const git = (...args: string[]): string | undefined => {
  try {
    return execFileSync('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

/** origin/<branch> is an ancestor of HEAD (merged into the tree under test). */
export function branchLanded(branch: string): boolean {
  if (git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) === undefined)
    return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', `origin/${branch}`, 'HEAD'], {
      cwd: REPO,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function branchOnOrigin(branch: string): boolean {
  return git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) !== undefined;
}

function filesPresent(p: Probe): boolean {
  if (!p.files?.length) return false;
  return p.files.every((f) => {
    const abs = path.join(REPO, f.path);
    try {
      if (!fs.existsSync(abs)) return false;
      if (!f.contains) return true;
      if (fs.statSync(abs).isDirectory()) return true;
      return fs.readFileSync(abs, 'utf8').includes(f.contains);
    } catch {
      return false;
    }
  });
}

export const probeBuilt = (p: Probe): boolean => branchLanded(p.owner) || filesPresent(p);

/** Owner branches whose probe fails ([] means every probe passed). */
export function missing(probes: Probe[]): string[] {
  return [...new Set(probes.filter((p) => !probeBuilt(p)).map((p) => p.owner))];
}

/** Evidence for the report: each owner branch and where it stands. */
export function branchTable(
  owners: string[],
): { branch: string; onOrigin: boolean; landed: boolean }[] {
  return owners.map((branch) => ({
    branch,
    onOrigin: branchOnOrigin(branch),
    landed: branchLanded(branch),
  }));
}

/** The capabilities the journey depends on, one probe each. Paths are the review's file ownership table. */
export const P = {
  context: {
    owner: 'feature/context-store',
    files: [{ path: 'packages/core/src/context.ts' }],
    why: 'ContextItem store, normalizer, retrieval, citation generalisation',
  },
  connectors: {
    owner: 'feature/context-store',
    files: [
      { path: 'apps/hub/src/connectors/canvas' },
      { path: 'apps/hub/src/connectors/google' },
    ],
    why: 'Canvas feed + Google OAuth connectors with hub_connections',
  },
  mentions: {
    owner: 'feature/typed-mentions',
    files: [{ path: 'apps/bot/src/mention.ts', contains: 'parseMentions' }],
    why: '@tutor/@planner/@cubbi typed mentions and persona attribution',
  },
  imsync: {
    owner: 'feature/imessage-sync',
    files: [{ path: 'apps/hub/src/imessage/store.ts', contains: 'chat_msg_xref' }],
    why: 'GUID xref, ordering, delivery state, backfill, multi-thread bindings',
  },
  a2a: {
    owner: 'feature/w0-a2a-contracts',
    files: [{ path: 'packages/core/src/a2a.ts' }],
    why: 'A2A task contracts used by agent delegation and taskId on chat cards',
  },
  council: {
    owner: 'feature/w1-council-runtime',
    why: 'live agent runtime: the addressed persona answers with the same grounded context',
  },
  board: {
    owner: 'feature/w5-council-board',
    why: 'agent activity (typing, thinking, offline) surfaced on the board and in chat',
  },
  trip: {
    owner: 'feature/trip-collab',
    files: [{ path: 'apps/hub/src/routes/trips.ts' }],
    why: 'Trip object, per-member state, rev + 409 conflicts, confirm once',
  },
  study: {
    owner: 'feature/study-plan',
    files: [{ path: 'packages/core/src/plan.ts' }],
    why: 'Plan object, owners, acceptances, rev + 409 conflicts, exam countdown',
  },
  blankShell: {
    owner: 'fix/blank-shell',
    why: 'the web shell renders (web chat is the mirror under test)',
  },
  floatingChat: {
    owner: 'fix/floating-chat',
    why: 'the chat dock opens and shows the thread',
  },
} satisfies Record<string, Probe>;
