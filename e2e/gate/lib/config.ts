// Gate-owned ports and paths. The gate NEVER reuses the e2e stack ports (8851/5251/4151) nor anyone else's.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const E2E_DIR = path.resolve(GATE_DIR, '..');
export const REPO = path.resolve(E2E_DIR, '..');
export const TMP = path.join(GATE_DIR, '.tmp');
export const RESULTS_DIR = path.join(TMP, 'results');
export const SHOTS = path.join(REPO, 'docs/design/shots/gate');
export const REPORT_MD = path.join(REPO, 'docs/qa/RELEASE-GATE-REPORT.md');
export const REPORT_JSON = path.join(REPO, 'docs/qa/RELEASE-GATE-REPORT.json');
export const KILL_FILE = path.join(REPO, '.gate-kill');

export const HUB_PORT = Number(process.env.GATE_HUB_PORT ?? 8927);
export const WEB_PORT = Number(process.env.GATE_WEB_PORT ?? 5327);
export const AGENT_BASE = Number(process.env.GATE_AGENT_BASE ?? 4771);
export const CANVAS_PORT = Number(process.env.GATE_CANVAS_PORT ?? 8940);
export const GOOGLE_PORT = Number(process.env.GATE_GOOGLE_PORT ?? 8941);
export const CTL_PORT = Number(process.env.GATE_CTL_PORT ?? 8942);

export const HUB = `http://localhost:${HUB_PORT}`;
export const WEB = `http://localhost:${WEB_PORT}`;
export const CANVAS = `http://localhost:${CANVAS_PORT}`;
export const GOOGLE = `http://localhost:${GOOGLE_PORT}`;
export const CTL = `http://localhost:${CTL_PORT}`;

export const SECRET = 'dev-internal-secret';
export const AGENT_IDS = ['s_ana', 's_ben', 's_chi', 's_dev'] as const;
export const AGENT_PORT = (id: string) =>
  AGENT_BASE + AGENT_IDS.indexOf(id as (typeof AGENT_IDS)[number]);
export const AGENT_URL = (id: string) => `http://localhost:${AGENT_PORT(id)}`;

/** Mode flags. Nothing real runs unless asked for explicitly. */
export const LIVE = process.env.LIVE === '1';
export const GATE_REAL = process.env.GATE_REAL === '1';
export const GATE_DRY_RUN = process.env.GATE_DRY_RUN !== '0'; // real runs are dry-run unless explicitly disabled
export const BUDGET_USD = Number(process.env.GATE_BUDGET_USD ?? 1);
export const MAX_LIVE_AGENTS = 3;

/** Privacy sentinels (RELEASE-GATE section 3). Seeded values that must never reach a surface that is not theirs. */
export const SENTINELS = {
  budget: '$180',
  topic: 'therapy',
  calTitle: 'SENTINEL_CAL_TITLE',
  driveHidden: 'SENTINEL_UNPICKED_DRIVE_FILE',
  grade: 'SENTINEL_CANVAS_GRADE_97',
  refreshToken: 'SENTINEL_REFRESH_TOKEN',
  feedSecret: 'SENTINEL_FEED_SECRET',
} as const;
