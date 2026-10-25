/* pnpm interior:import [--dry-run] [--zip file] [--dir folder] [--out folder] [--recipe file]
 *
 * Reads the locally licensed Modern Interiors pack (LimeZu) and composes the optional indoor skins into the
 * gitignored assets/vendor/interiors/. Nothing derived from the pack is ever written anywhere git tracks. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateRecipe } from './recipe';
import {
  DEFAULT_OUT,
  defaultZip,
  dirSource,
  loadRecipes,
  runImport,
  zipSource,
  type PackSource,
} from './importer';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : undefined;
};

function fail(msg: string): never {
  console.error(`interior:import: ${msg}`);
  process.exit(1);
}

if (flag('help')) {
  console.log(
    'usage: pnpm interior:import [--dry-run] [--zip file.zip | --dir extracted/pack] [--out assets/vendor/interiors] [--recipe file.json]\n' +
      'pack location: --zip, else $MODERN_INTERIORS_DIR (extracted folder), else $MODERN_INTERIORS_ZIP, else vendor-local/moderninteriors/moderninteriors-win.zip in this checkout or a parent folder.',
  );
  process.exit(0);
}

let source: PackSource;
try {
  const dir = opt('dir') ?? (opt('zip') ? undefined : process.env.MODERN_INTERIORS_DIR);
  if (dir) source = dirSource(resolve(dir));
  else {
    const zip = opt('zip') ? resolve(opt('zip')!) : defaultZip();
    if (!zip)
      fail(
        'no pack found. Set MODERN_INTERIORS_ZIP to your licensed moderninteriors-win.zip (or pass --zip / --dir). The app runs fine without it and keeps the classic art.',
      );
    source = zipSource(zip);
  }
} catch (e) {
  fail(`cannot open the pack: ${(e as Error).message}`);
}

const recipes = opt('recipe')
  ? [validateRecipe(JSON.parse(readFileSync(resolve(opt('recipe')!), 'utf8')))]
  : loadRecipes();
const dryRun = flag('dry-run');
const out = resolve(opt('out') ?? DEFAULT_OUT);

try {
  const rep = runImport({ source, recipes, out, dryRun });
  console.log(`pack: ${rep.source}\nout:  ${rep.out}${dryRun ? '  (dry run, nothing written)' : ''}`);
  for (const r of rep.recipes) {
    console.log(`\n${r.id}: ${r.files.length} pack files`);
    for (const f of r.files) console.log(`  ${f.found ? 'ok     ' : 'MISSING'} ${f.path}`);
    for (const p of r.problems) console.log(`  problem: ${p}`);
    for (const w of r.written) console.log(`  wrote ${w}`);
  }
  if (!rep.ok) fail('the pack does not match the recipe (see problems above).');
  console.log(
    dryRun
      ? '\nDry run ok: every named tile exists. Run without --dry-run to compose.'
      : '\nDone. Credit when the skin is active: "World art: Modern Interiors by LimeZu". Reload the app to see it (`?skin=off` for the classic art).',
  );
} catch (e) {
  fail((e as Error).message);
}
