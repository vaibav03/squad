/**
 * pnpm a11y:check  [--update-baseline] [--no-boot] [--verbose]
 * Runs axe (WCAG 2.2 A/AA + best-practice) on every route in two variants and the keyboard specs in
 * apps/web-host/e2e-a11y/specs.ts. Exits 1 on violations NOT in scripts/a11y/baseline.json (new rule, or more nodes
 * than the baseline), on a failing spec, or on a known-fail spec that has started passing (drop its marker).
 * If the stack is not up it boots `dev:all --no-agents` on A11Y ports (15911 web, 18911 hub) and stops it afterwards.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { A11Y_DIR, BASE, ROOT, ROUTES, gotoRoute, newPage, pw, runAxe, vname, type Variant } from './lib';
import { specs } from '../../apps/web-host/e2e-a11y/specs';

const args = new Set(process.argv.slice(2));
const BASELINE = path.join(A11Y_DIR, 'baseline.json');
const VARIANTS: Variant[] = [
  { w: 1280, h: 800, theme: 'dark', calm: false, reduced: true },
  { w: 390, h: 844, theme: 'light', calm: true, reduced: true },
];

async function up(url: string) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function main() {
  let stack: ChildProcess | undefined;
  if (!args.has('--no-boot') && !(await up(BASE))) {
    console.log('booting dev stack (hub 18911, web 15911)...');
    stack = spawn('pnpm', ['dev:all', '--no-agents'], {
      cwd: ROOT,
      env: { ...process.env, DEV_ALL_HUB_PORT: '18911', DEV_ALL_WEB_PORT: '15911' },
      stdio: 'ignore',
      detached: true,
    });
    for (let i = 0; i < 90 && !(await up(BASE)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await up(BASE))) throw new Error('stack did not come up');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const stop = () => stack?.pid && process.kill(-stack.pid, 'SIGTERM');
  const browser = await pw.chromium.launch();
  const found: Record<string, number> = {};
  const failures: string[] = [];
  try {
    for (const v of VARIANTS)
      for (const r of ROUTES) {
        const { ctx, page } = await newPage(browser, v);
        await gotoRoute(page, r);
        for (const x of await runAxe(page)) {
          found[`${r.id}|${vname(v)}|${x.id}`] = x.nodes.length;
          if (args.has('--verbose')) console.log(r.id, vname(v), x.id, x.nodes.length, x.nodes[0]?.target.join(' '));
        }
        await ctx.close();
      }
    const base: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    if (args.has('--update-baseline')) {
      writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(Object.entries(found).sort()), null, 2) + '\n');
      console.log(`baseline written: ${Object.keys(found).length} entries`);
    } else {
      for (const [k, n] of Object.entries(found))
        if (!(k in base)) failures.push(`NEW axe violation ${k} (${n} nodes)`);
        else if (n > base[k]!) failures.push(`WORSE axe violation ${k}: ${base[k]} -> ${n} nodes`);
      const fixed = Object.keys(base).filter((k) => !(k in found));
      if (fixed.length) console.log(`note: ${fixed.length} baseline entries no longer occur; run --update-baseline to ratchet`);
    }
    for (const s of specs) {
      const { ctx, page } = await newPage(browser, { w: s.viewport?.w ?? 1280, h: s.viewport?.h ?? 800, theme: 'dark', calm: false, reduced: false });
      let err: string | undefined;
      try {
        await s.run(page);
      } catch (e) {
        err = (e as Error).message.split('\n')[0];
      }
      await ctx.close();
      const tag = s.knownFail ? ` [known-fail ${s.knownFail}]` : '';
      if (err && !s.knownFail) failures.push(`SPEC FAIL ${s.name}: ${err}`);
      else if (!err && s.knownFail) failures.push(`SPEC NOW PASSES ${s.name}: remove knownFail ${s.knownFail}`);
      console.log(`${err ? (s.knownFail ? 'xfail' : 'FAIL ') : s.knownFail ? 'XPASS' : 'pass '} ${s.name}${tag}${err ? '  -> ' + err : ''}`);
    }
  } finally {
    await browser.close();
    stop();
  }
  console.log(`\naxe entries: ${Object.keys(found).length}`);
  if (failures.length) {
    console.error('\na11y:check FAILED\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log('a11y:check ok');
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
