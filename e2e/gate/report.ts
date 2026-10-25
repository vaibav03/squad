// Report generator: reads the per-step JSON written by the runner (and by `pnpm gate:smoke` for the real column) and
// writes docs/qa/RELEASE-GATE-REPORT.md plus .json. Exit code: 1 when any BUILT step FAILs (or the harness itself
// broke), 3 with GATE_STRICT=1 when anything is NOT_BUILT or BLOCKED, otherwise 0.
// The report never contains message bodies, tokens or URLs with secrets: every string is scrubbed before it is written.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  GATE_REAL,
  LIVE,
  REPO,
  REPORT_JSON,
  REPORT_MD,
  RESULTS_DIR,
  REAL_RESULTS_DIR,
  SENTINELS,
  SHOTS,
} from './lib/config';
import { allBlockers } from './lib/blockers';
import { branchTable } from './lib/probes';
import type { StepResult } from './lib/types';

export const JOURNEY = [
  'S0', 'S1', 'S1b', 'S1c', 'S2', 'S3', 'S3e', 'S4', 'S4s', 'S5', 'S5b', 'S6', 'S6s', 'S7', 'S7s', 'S8', 'S9', 'S9b', 'S10', 'S10b', 'S10s',
];
export const VARIANTS = Array.from({ length: 13 }, (_, i) => `V${i + 1}`);

const git = (...a: string[]): string => {
  try {
    return execFileSync('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

function readResults(dir: string): StepResult[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as StepResult);
  } catch {
    return [];
  }
}

const SCRUB = [
  ...Object.values(SENTINELS),
  ...(process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : []),
  ...(process.env.GATE_CANVAS_FEED_URL ? [process.env.GATE_CANVAS_FEED_URL] : []),
  ...(process.env.GATE_CANVAS_TOKEN ? [process.env.GATE_CANVAS_TOKEN] : []),
].filter((s) => s && s.length > 3);
const scrub = (t: string): string => SCRUB.reduce((acc, s) => acc.split(s).join('***'), t);

const cell = (r: StepResult | undefined): string => {
  if (!r) return 'NOT_RUN';
  switch (r.status) {
    case 'PASS':
      return `PASS (${r.label})`;
    case 'FAIL':
      return `FAIL: ${r.reason ?? ''}`;
    case 'BLOCKED':
      return `BLOCKED(${r.reason}${r.runbook ? `, [runbook](RELEASE-GATE.md${r.runbook})` : ''})`;
    case 'NOT_BUILT':
      return `NOT_BUILT(${(r.owner ?? []).join(', ')})`;
    case 'SKIPPED':
      return `SKIPPED(${r.reason})`;
  }
};

export interface Summary {
  fixtureFail: number;
  realFail: number;
  notBuilt: number;
  blocked: number;
  fixturePass: number;
  total: number;
}

export async function buildReport(): Promise<{
  md: string;
  json: unknown;
  summary: Summary;
  code: number;
}> {
  const fx = readResults(RESULTS_DIR).filter((r) => r.mode === 'fixture');
  const rl = [...readResults(RESULTS_DIR), ...readResults(REAL_RESULTS_DIR)].filter(
    (r) => r.mode === 'real',
  );
  const byId = (rs: StepResult[], id: string) => rs.find((r) => r.id === id);
  const ids = [...JOURNEY, ...VARIANTS];

  const summary: Summary = {
    fixtureFail: 0,
    realFail: 0,
    notBuilt: 0,
    blocked: 0,
    fixturePass: 0,
    total: ids.length,
  };
  for (const id of ids) {
    const f = byId(fx, id);
    const r = byId(rl, id);
    if (f?.status === 'FAIL') summary.fixtureFail++;
    if (r?.status === 'FAIL') summary.realFail++;
    if (f?.status === 'NOT_BUILT') summary.notBuilt++;
    if (f?.status === 'PASS') summary.fixturePass++;
    if (r?.status === 'BLOCKED') summary.blocked++;
  }
  const notRun = ids.filter((id) => !byId(fx, id)).length;
  const harnessBroke = fx.length === 0;

  const verdict = harnessBroke
    ? 'HARNESS-ERROR (no step results; see e2e/gate/.tmp/*.log)'
    : summary.fixtureFail + summary.realFail > 0
      ? 'RED (a BUILT step failed)'
      : summary.notBuilt > 0
        ? `INCOMPLETE (${summary.notBuilt} of ${ids.length} fixture steps NOT_BUILT; nothing built is failing)`
        : summary.blocked > 0
          ? 'FIXTURE-GREEN / REAL-BLOCKED'
          : 'GREEN';

  const blockers = await allBlockers();
  const owners = [...new Set(fx.flatMap((r) => r.owner ?? []))].sort();
  const branches = branchTable(owners);
  const head = git('rev-parse', '--short', 'HEAD');
  const main = git('rev-parse', '--short', 'origin/main');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

  // key screenshots: one per selected step, copied to key-*.png (the only pngs that are committed)
  const keep = ['S3', 'S6', 'S7', 'S8', 'S9', 'S10'];
  const keys: string[] = [];
  for (const id of keep) {
    const shot = byId(fx, id)?.evidence.find((e) => e.endsWith('.png'));
    if (!shot) continue;
    const src = path.join(REPO, shot);
    const dst = path.join(SHOTS, `key-${path.basename(shot)}`);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        keys.push(path.relative(REPO, dst));
      }
    } catch {
      /* best effort */
    }
  }

  const line = (id: string) => {
    const f = byId(fx, id);
    const r = byId(rl, id);
    const title = (f ?? r)?.title ?? '';
    const ev = [...(f?.evidence ?? []), ...(r?.evidence ?? [])];
    return `| ${id} | ${title} | ${cell(f)} | ${cell(r)} | ${ev.length ? ev.map((e) => `\`${e}\``).join('<br>') : ''} |`;
  };

  const md: string[] = [];
  md.push('# Release gate report', '');
  md.push(
    `Generated ${new Date().toISOString()} by \`pnpm gate\` (tree ${branch}@${head}, origin/main@${main}).`,
  );
  md.push(
    `Mode: LLM ${LIVE ? '`LIVE=1` (real Gemini only if the hub probe says the key has credit)' : 'fake model, labelled **Demo**'}; real integrations ${GATE_REAL ? 'requested' : 'not requested'}.`,
    '',
  );
  md.push(`## Verdict: ${verdict}`, '');
  md.push(
    `Fixture steps: ${summary.fixturePass} PASS, ${summary.fixtureFail} FAIL, ${summary.notBuilt} NOT_BUILT, ${notRun} not run, of ${ids.length}. A NOT_BUILT step is never a PASS: its owner branch is not on origin/main.`,
    '',
  );
  md.push('## Journey (one world, one chain)', '');
  md.push('| Step | What | Fixture | Real | Evidence |', '|---|---|---|---|---|');
  for (const id of JOURNEY) md.push(line(id));
  md.push('', '## Variants', '');
  md.push('| Variant | What | Fixture | Real | Evidence |', '|---|---|---|---|---|');
  for (const id of VARIANTS) md.push(line(id));

  const failed = [...fx, ...rl].filter((r) => r.status === 'FAIL');
  if (failed.length) {
    md.push('', '## Failures', '');
    for (const r of failed) {
      md.push(`### ${r.id} (${r.mode}) ${r.title}`, '');
      for (const a of r.assertions.filter((x) => !x.pass))
        md.push(`- ${a.name}${a.detail ? `: ${a.detail}` : ''}`);
      md.push('');
    }
  }

  const nb = fx.filter((r) => r.status === 'NOT_BUILT');
  if (nb.length) {
    md.push('', '## Not built yet (owner branch not on origin/main)', '');
    md.push('| Owner branch | On origin | Landed on this tree |', '|---|---|---|');
    for (const b of branches)
      md.push(`| \`${b.branch}\` | ${b.onOrigin ? 'yes' : 'no'} | ${b.landed ? 'yes' : 'no'} |`);
    md.push('', 'Steps waiting, with what is missing:', '');
    for (const r of nb)
      md.push(
        `- ${r.id} ${r.title}: ${(r.owner ?? []).map((o) => `\`${o}\``).join(', ')} (${r.reason ?? ''})`,
      );
    const pv = nb.filter((r) => r.preview?.length);
    if (pv.length) {
      md.push(
        '',
        'Preview assertions that already run against what is on main (informational, never counted as PASS):',
        '',
      );
      for (const r of pv) {
        const p = r.preview ?? [];
        md.push(
          `- ${r.id}: ${p.filter((x) => x.pass).length}/${p.length} would pass${
            p.some((x) => !x.pass)
              ? ` (failing: ${p
                  .filter((x) => !x.pass)
                  .map((x) => x.name)
                  .join('; ')})`
              : ''
          }`,
        );
      }
    }
  }

  md.push('', '## External blockers (code cannot fix these)', '');
  md.push('| Blocker | Now | Why | Runbook |', '|---|---|---|---|');
  for (const b of blockers)
    md.push(
      `| \`${b.code}\` | ${b.blocked ? 'BLOCKED' : 'clear'} | ${b.reason} | [runbook](RELEASE-GATE.md${b.runbook}) |`,
    );

  const notes = [...fx, ...rl].flatMap((r) => r.notes.map((n) => `- ${r.id} (${r.mode}): ${n}`));
  if (notes.length) md.push('', '## Notes', '', ...notes);
  if (keys.length) md.push('', '## Key screenshots', '', ...keys.map((k) => `- \`${k}\``));
  md.push('', 'How to run and read this: [RELEASE-GATE.md](RELEASE-GATE.md).', '');

  const code = harnessBroke
    ? 2
    : summary.fixtureFail + summary.realFail > 0
      ? 1
      : process.env.GATE_STRICT === '1' &&
          (summary.notBuilt > 0 || summary.blocked > 0 || notRun > 0)
        ? 3
        : 0;
  const json = {
    generatedAt: new Date().toISOString(),
    tree: { branch, head, originMain: main },
    mode: { live: LIVE, real: GATE_REAL },
    verdict,
    summary,
    fixture: fx.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    real: rl.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    blockers,
    branches,
    keyScreenshots: keys,
  };
  return { md: scrub(md.join('\n')), json: JSON.parse(scrub(JSON.stringify(json))), summary, code };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { md, json, code } = await buildReport();
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(REPORT_MD, md);
  fs.writeFileSync(REPORT_JSON, JSON.stringify(json, null, 2) + '\n');
  console.log(`gate report: ${path.relative(REPO, REPORT_MD)}  (exit ${code})`);
  console.log(md.split('\n').find((l) => l.startsWith('## Verdict')) ?? '');
  process.exit(code);
}
