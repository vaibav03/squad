/**
 * pnpm live:verify: go-live verification of every real model path, under a hard spend cap.
 *
 *   SQUAD_LIVE=1 pnpm live:verify                      # all checks (default caps: 60 calls / 40k tokens / 800 chars / $0.50)
 *   SQUAD_LIVE=1 LIVE_ONLY=2,4 pnpm live:verify        # a subset
 *   SQUAD_LIVE=1 LIVE_ELEVENLABS=1 pnpm live:verify    # also allow the (possibly billed) voice design
 *
 * Refuses to run unless SQUAD_LIVE=1. Keys come from .env and are never printed. Exit codes:
 * 0 pass, 1 a check failed, 2 refused (no SQUAD_LIVE / no keys), 3 aborted by 402/401/429, 4 budget cap hit.
 * See docs/live/RUNBOOK.md.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALL_CHECKS } from './checks';
import { runVerify } from './lib/core';
import { loadEnv, makeRedactor, ROOT } from './lib/env';
import { consoleSummary, writeReports } from './lib/report';

export async function main(): Promise<number> {
  const { env, fileExists } = loadEnv();
  const redact = makeRedactor(env);
  if (env.SQUAD_LIVE !== '1') {
    console.log(
      [
        'live:verify refuses to run: SQUAD_LIVE is not 1.',
        'This harness makes REAL paid model calls (capped). To run it deliberately:',
        '  SQUAD_LIVE=1 pnpm live:verify',
        'Caps (env): LIVE_MAX_CALLS=60 LIVE_MAX_TOKENS=40000 LIVE_MAX_EL_CHARS=800 LIVE_MAX_USD=0.50',
        'Runbook: docs/live/RUNBOOK.md',
      ].join('\n'),
    );
    return 2;
  }
  if (!fileExists) console.log('note: no .env found at the repo root; using the process environment only.');
  if (!env.GEMINI_API_KEY && !env.ELEVENLABS_API_KEY) {
    console.log('live:verify: neither GEMINI_API_KEY nor ELEVENLABS_API_KEY is set (put them in .env). Nothing to verify.');
    return 2;
  }
  const { report } = await runVerify({ env, checks: ALL_CHECKS, log: (l) => console.log(redact(l)) });
  const out = writeReports(report, redact, path.join(ROOT, 'docs', 'live'));
  console.log(consoleSummary(report, redact));
  console.log(`report: ${path.relative(ROOT, out.md)} and ${path.relative(ROOT, out.json)}`);
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error('live:verify crashed:', (e as Error).message);
      process.exit(1);
    },
  );
}
