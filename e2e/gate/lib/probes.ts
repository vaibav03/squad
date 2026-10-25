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
  if (git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`) === undefined) {
    // the branch was deleted after landing: a merge commit on this tree names it
    const hit = git(
      'log',
      'HEAD',
      '--merges',
      '-n1',
      '--format=%h',
      '-F',
      `--grep=Merge ${branch}`,
    );
    return !!hit;
  }
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
    owner: 'feature/nook-parity',
    files: [
      { path: 'packages/core/src/context.ts' },
      { path: 'packages/brain/src/context/store.ts' },
    ],
    why: 'ContextItem store, normalizer, retrieval, citation generalisation (feature/context-store lands inside nook-parity)',
  },
  connectors: {
    owner: 'feature/nook-parity',
    files: [
      { path: 'apps/hub/src/routes/connections.ts' },
      { path: 'apps/hub/src/context/service.ts' },
    ],
    why: 'Canvas + Google connections routes with encrypted tokens, minimal scopes and the labelled simulator',
  },
  mentions: {
    owner: 'feature/typed-mentions',
    files: [{ path: 'packages/core/src/mentions.ts' }],
    why: '@tutor/@planner/@cubbi typed mentions and persona attribution',
  },
  imsync: {
    owner: 'feature/imessage-sync',
    files: [{ path: 'apps/hub/src/imessage/sync.ts' }],
    why: 'GUID xref, ordering, delivery state, backfill, multi-thread bindings',
  },
  sendblue: {
    owner: 'feature/sendblue',
    files: [{ path: 'apps/hub/src/imessage/sendblue/webhook.ts' }],
    why: 'Sendblue provider: signed webhook, send API, id map, delivery states, health probes',
  },
  a2a: {
    owner: 'feature/w0-a2a-contracts',
    files: [{ path: 'packages/core/src/a2a.ts' }],
    why: 'A2A task contracts used by agent delegation and taskId on chat cards',
  },
  board: {
    owner: 'feature/w5-council-board',
    files: [{ path: 'packages/village/src/council/module.ts' }],
    why: 'agent activity (typing, thinking, offline) surfaced on the board',
  },
  focusPanel: {
    owner: 'feature/agent-focus-panel',
    files: [{ path: 'packages/web/src/overlays/inspector/focus/FocusShell.tsx' }],
    why: 'focused agent panel: Conversation, Activity, Decisions, handoff timeline, reasoning summaries',
  },
  designSystem: {
    owner: 'feature/design-system-deliberation',
    files: [{ path: 'scripts/audit-chrome.mjs' }, { path: 'packages/web/src/primitives/StatusChip.tsx' }],
    why: 'one icon family, StatusChip (icon + word), chrome audit with no decorative emoji or dot markers',
  },
  deliberation: {
    owner: 'feature/design-system-deliberation',
    files: [{ path: 'packages/web/src/council/deliberation/BallotMatrix.tsx' }],
    why: 'deliberation surface: phases, turn cards, ballot matrix, pinned decision card',
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
