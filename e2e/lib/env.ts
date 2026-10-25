import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(E2E_DIR, '..');
export const TMP = path.join(E2E_DIR, '.tmp');
export const HUB_PORT = Number(process.env.E2E_HUB_PORT ?? 8851);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5251);
export const HUB = `http://localhost:${HUB_PORT}`;
export const WEB = `http://localhost:${WEB_PORT}`;
export const LIVE = process.env.LIVE === '1';
export const SECRET = 'dev-internal-secret';
export const SHOTS = path.join(REPO, 'docs/design/shots/e2e');
export const FIXTURE_PDFS = path.join(REPO, 'packages/brain/fixtures/openstax');
export const ICS_DIR = path.join(REPO, 'apps/agent/fixtures/ics');
export const STUDENTS = ['s_ana', 's_ben', 's_chi', 's_dev'] as const;
export type StudentId = (typeof STUDENTS)[number];
export const AGENT_BASE = Number(process.env.E2E_AGENT_BASE ?? 4151);
export const AGENT_IDS = ['s_ana', 's_ben', 's_cam', 's_dev'] as const; // agents are named after the dev:all fixtures
export const AGENT_PORT = (id: string) => AGENT_BASE + AGENT_IDS.indexOf(id as (typeof AGENT_IDS)[number]);
export const AGENT_URL = (id: string) => `http://localhost:${AGENT_PORT(id)}`;
