/**
 * Generates the endpoint table in docs/api/HUB-API.md from the route registrations in apps/hub/src.
 *   tsx scripts/docs/gen-api.ts           rewrite the table between the BEGIN/END markers
 *   tsx scripts/docs/gen-api.ts --check   exit 1 if the doc is out of date (no write)
 * Sources: app.ts (health), routes/*.ts (r.get/post/put('...')), ws.ts (call websocket path).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'apps/hub/src');
const DOC = path.join(ROOT, 'docs/api/HUB-API.md');
const BEGIN = '<!-- BEGIN GENERATED ENDPOINTS -->';
const END = '<!-- END GENERATED ENDPOINTS -->';

/** Human descriptions, keyed by "METHOD path". A route without an entry is listed with "(undocumented)". */
const DESC: Record<string, string> = {
  'GET /health': 'Liveness and counters',
  'GET /v1/health': 'Same as /health',
  'GET /v1/status': 'Public: real vs demo model (llm, tts, reason, probe times, notice)',
  'GET /v1/auth/students': 'Public list of students for the sign-in picker',
  'POST /v1/auth/dev-login': 'Sign-in stub: studentId to bearer token',
  'GET /v1/me': 'Current student, squad id, projector flag',
  'POST /v1/squad/stream-token': 'Short-lived `st` token for SSE and the call websocket',
  'POST /v1/session/projector': 'Turn projector mode on or off for this session',
  'POST /internal/events': 'Emitters post VillageEvents or x.* envelopes (shared secret)',
  'GET /v1/squad/state': 'Per-viewer snapshot with `seq` for late joiners',
  'GET /v1/squad/stream': 'SSE stream, filtered per viewer, resumable with Last-Event-ID',
  'GET /v1/stream':
    'Multiplexed SSE: squad + chat channels on one connection, composite Last-Event-ID',
  'GET /v1/squad/replays': 'List replay scripts',
  'GET /v1/squad/replay/:name': 'One replay script, filtered as `cast.me`',
  'GET /v1/quiz/:quizId': 'Open quiz question (never the answer key)',
  'POST /v1/quiz/:quizId/answer': 'Answer a quiz (idempotent per student)',
  'POST /v1/call/start': 'Open a call with an agent: callId, wsUrl, ticket',
  'GET /v1/personas': 'List personas',
  'PUT /v1/personas/:id': 'Update a persona voice or avatar',
  'GET /v1/voices': 'List voices',
  'POST /v1/voices/preview': 'Audio preview of a voice (audio/mpeg)',
  'GET /v1/tasks': 'Tasks visible to the viewer',
  'GET /v1/ledger/:taskId': 'Disclosure ledger; the owner also sees own raw values',
  'GET /v1/trips/:tripId': 'Viewer-filtered trip view (secret ballot)',
  'POST /v1/trips/:tripId/vote': 'Record the viewer ranking',
  'POST /v1/trips/:tripId/confirm': 'Confirm an option; trip.confirmed once all said yes',
  'POST /v1/confirms/:taskId': 'Answer a generic pending confirm (yes/no)',
  'GET /v1/mastery/:courseId': 'Mastery per concept, squad average only for 3+ members',
  'GET /v1/squad/courses': 'Courses and ingest status',
  'POST /v1/squad/courses': 'Upload a course PDF (multipart, 50 MB cap)',
  'POST /v1/squad/calendar': 'Import an .ics file or the demo calendar',
  'POST /__sim/squad/demo-run': 'Play a scripted run onto the stream',
  'POST /__sim/squad/reset': 'Clear log and state, reseed',
  'POST /__sim/squad/emit': 'Emit an event without the secret',
  'WS /v1/call/ws/:callId': 'Call websocket (JSON frames and audio), `?st=` ticket',
};

interface Row {
  method: string;
  route: string;
  auth: string;
  file: string;
}

function authOf(route: string, rest: string): string {
  if (route.startsWith('/__sim/')) return 'none (dev only, HUB_SIM=1)';
  if (route === '/internal/events') return 'X-Nook-Internal secret';
  if (route === '/v1/squad/stream' || route === '/v1/stream') return 'bearer or `?st=`';
  if (/\b(need|requireViewer)\b/.test(rest)) return 'bearer';
  return 'public';
}

export function collect(): Row[] {
  const rows: Row[] = [];
  const files = [
    'app.ts',
    ...readdirSync(path.join(SRC, 'routes'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `routes/${f}`),
  ];
  const re = /\b(?:r|app)\.(get|post|put|delete|patch)\(\s*'([^']+)'([^\n]*)/g;
  for (const f of files) {
    const text = readFileSync(path.join(SRC, f), 'utf8');
    for (const m of text.matchAll(re)) {
      const [, method, route, rest] = m as unknown as [string, string, string, string];
      rows.push({
        method: method.toUpperCase(),
        route,
        auth: authOf(route, rest),
        file: `apps/hub/src/${f}`,
      });
    }
  }
  const ws = readFileSync(path.join(SRC, 'ws.ts'), 'utf8');
  if (/\\\/v1\\\/call\\\/ws\\\//.test(ws)) {
    rows.push({
      method: 'WS',
      route: '/v1/call/ws/:callId',
      auth: '`?st=` call ticket',
      file: 'apps/hub/src/ws.ts',
    });
  }
  const order = (r: Row) => (r.route.startsWith('/__sim') ? 2 : r.route === '/internal/events' ? 1 : 0);
  return rows.sort(
    (a, b) => order(a) - order(b) || a.route.localeCompare(b.route) || a.method.localeCompare(b.method),
  );
}

export function render(rows: Row[]): string {
  const lines = [
    '| Method | Path | Auth | Purpose | Registered in |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const d = DESC[`${r.method} ${r.route}`] ?? '(undocumented)';
    lines.push(`| ${r.method} | \`${r.route}\` | ${r.auth} | ${d} | \`${r.file}\` |`);
  }
  return lines.join('\n');
}

const rows = collect();
const block = `${BEGIN}\n<!-- Generated by scripts/docs/gen-api.ts from apps/hub/src; do not edit by hand. -->\n\n${render(rows)}\n\n${END}`;
const doc = readFileSync(DOC, 'utf8');
const i = doc.indexOf(BEGIN);
const j = doc.indexOf(END);
if (i < 0 || j < 0) {
  console.error(`markers missing in ${DOC}`);
  process.exit(2);
}
const next = doc.slice(0, i) + block + doc.slice(j + END.length);
const missing = rows.filter((r) => !DESC[`${r.method} ${r.route}`]);
if (missing.length) console.error('undocumented routes:', missing.map((r) => `${r.method} ${r.route}`).join(', '));
if (process.argv.includes('--check')) {
  if (next !== doc || missing.length) {
    console.error('docs/api/HUB-API.md is out of date: run `pnpm exec tsx scripts/docs/gen-api.ts`');
    process.exit(1);
  }
  console.log(`HUB-API.md endpoint table is up to date (${rows.length} routes)`);
} else {
  writeFileSync(DOC, next);
  console.log(`wrote ${rows.length} routes to docs/api/HUB-API.md`);
}
