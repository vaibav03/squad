import fs from 'node:fs';
import path from 'node:path';
import type { RunReport } from './types';

const icon = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' } as const;

export function renderMarkdown(r: RunReport, redact: (s: string) => string): string {
  const L: string[] = [];
  L.push('# Live verification: last run', '');
  L.push(`- Started: ${r.startedAt}`, `- Finished: ${r.finishedAt}`);
  L.push(`- Mode: ${r.mode}`);
  L.push(`- Outcome: **${r.outcome.toUpperCase()}** (exit code ${r.exitCode})`);
  L.push(`- Models: fast \`${r.models.fast}\`, main \`${r.models.main}\`, chair \`${r.models.chair}\``);
  L.push(
    `- Checks: ${r.summary.pass} PASS, ${r.summary.fail} FAIL, ${r.summary.skip} SKIP`,
    '',
  );
  if (r.aborted) {
    L.push('## Run aborted', '');
    L.push(`- Provider: ${r.aborted.provider}${r.aborted.status ? `, HTTP ${r.aborted.status}` : ''}`);
    L.push(`- What happened: ${r.aborted.message}`);
    L.push(`- Exact fix: ${r.aborted.fix}`, '');
  }
  L.push('## Spend', '');
  L.push('| Meter | Used | Cap |', '| --- | ---: | ---: |');
  L.push(`| Provider calls (HTTP attempts) | ${r.spend.calls} | ${r.limits.maxCalls} |`);
  L.push(`| Billed tokens | ${r.spend.billedTokens} | ${r.limits.maxTokens} |`);
  L.push(`| ElevenLabs characters | ${r.spend.chars} | ${r.limits.maxChars} |`);
  L.push(`| Estimated USD | ${r.spend.usd} | ${r.limits.maxUsd} |`);
  L.push(
    '',
    `Tokens in/out/cached: ${r.spend.inputTokens} / ${r.spend.outputTokens} / ${r.spend.cachedTokens}. Latency of successful model calls: p50 ${r.latency.p50} ms, p95 ${r.latency.p95} ms (n=${r.latency.n}).`,
    '',
    'USD is an estimate from LIVE_PRICE_* placeholders, not a bill.',
    '',
  );
  L.push('## Checks', '', '| # | Check | Result | Calls | Tokens | Chars | ms |', '| ---: | --- | --- | ---: | ---: | ---: | ---: |');
  for (const c of r.checks)
    L.push(`| ${c.id} | ${c.name} | ${icon[c.status]} | ${c.spend.calls} | ${c.spend.billedTokens} | ${c.spend.chars} | ${c.ms} |`);
  L.push('');
  for (const c of r.checks) {
    L.push(`### ${c.id}. ${c.name}: ${icon[c.status]}`, '');
    if (c.note) L.push(`Skipped: ${c.note}`, '');
    for (const [k, v] of Object.entries(c.metrics)) L.push(`- metric ${k}: ${v}`);
    if (Object.keys(c.metrics).length) L.push('');
    for (const s of c.steps) {
      L.push(`- ${icon[s.status]} ${s.name}`);
      for (const e of s.evidence) L.push(`  - ${e.replace(/\n/g, ' ').slice(0, 400)}`);
    }
    L.push('');
  }
  return redact(L.join('\n'));
}

export function writeReports(
  r: RunReport,
  redact: (s: string) => string,
  dir: string,
): { md: string; json: string } {
  fs.mkdirSync(dir, { recursive: true });
  const md = path.join(dir, 'LAST-RUN.md');
  const json = path.join(dir, 'last-run.json');
  fs.writeFileSync(md, renderMarkdown(r, redact));
  fs.writeFileSync(json, redact(JSON.stringify(r, null, 2)) + '\n');
  return { md, json };
}

/** One-screen console summary. */
export function consoleSummary(r: RunReport, redact: (s: string) => string): string {
  const L: string[] = [];
  for (const c of r.checks) {
    L.push(`${c.status.padEnd(4)}  ${String(c.id).padStart(2)}  ${c.name}${c.note ? `  (${c.note})` : ''}`);
    for (const s of c.steps.filter((x) => x.status === 'FAIL'))
      L.push(`        FAIL ${s.name}: ${s.evidence[0] ?? ''}`.slice(0, 220));
  }
  L.push('');
  if (r.aborted) {
    L.push(`ABORTED (${r.aborted.provider}${r.aborted.status ? ` HTTP ${r.aborted.status}` : ''}): ${r.aborted.message}`);
    L.push(`FIX: ${r.aborted.fix}`, '');
  }
  L.push(
    `spend: ${r.spend.calls} calls, ${r.spend.billedTokens} tokens, ${r.spend.chars} chars, ~$${r.spend.usd} (caps ${r.limits.maxCalls} calls / ${r.limits.maxTokens} tokens / ${r.limits.maxChars} chars / $${r.limits.maxUsd})`,
    `result: ${r.outcome.toUpperCase()}  ${r.summary.pass} pass, ${r.summary.fail} fail, ${r.summary.skip} skip`,
  );
  return redact(L.join('\n'));
}
