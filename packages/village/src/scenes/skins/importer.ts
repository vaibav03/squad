import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpriteBounds, compose } from './compose';
import { decodePng } from '../tools/png-decode';
import { encodePng } from '../tools/png';
import { neededFiles, validateRecipe } from './recipe';
import { openZip, readZipEntry } from './zip';
import { SKIN_ROOT, type LayerName, type Recipe, type SkinIndex, type SkinManifest } from './types';

/** Where pack files come from: a zip (the licensed download) or an extracted copy of the same folder layout. */
export interface PackSource {
  label: string;
  has(rel: string): boolean;
  read(rel: string): Buffer;
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../');
export const RECIPES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'recipes');
const ZIP_NAME = 'vendor-local/moderninteriors/moderninteriors-win.zip';

/** MODERN_INTERIORS_ZIP, else vendor-local/ in this checkout or any parent folder (worktrees live one level down). */
export function defaultZip(env: NodeJS.ProcessEnv = process.env, from = REPO_ROOT): string | null {
  if (env.MODERN_INTERIORS_ZIP) return resolve(env.MODERN_INTERIORS_ZIP);
  let dir = from;
  for (let i = 0; i < 5; i++) {
    const p = join(dir, ZIP_NAME);
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function zipSource(path: string): PackSource {
  const z = openZip(path);
  return {
    label: path,
    has: (rel) => z.entries.has(rel),
    read: (rel) => readZipEntry(z, rel),
  };
}

export function dirSource(root: string): PackSource {
  return {
    label: root,
    has: (rel) => existsSync(join(root, rel)),
    read: (rel) => readFileSync(join(root, rel)),
  };
}

export function loadRecipes(dir = RECIPES_DIR): Recipe[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => validateRecipe(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

export interface RecipeReport {
  id: string;
  files: Array<{ path: string; found: boolean }>;
  problems: string[];
  written: string[];
}
export interface ImportReport {
  source: string;
  out: string;
  dryRun: boolean;
  recipes: RecipeReport[];
  ok: boolean;
}

/** Refuse any output that git would track: under assets/vendor of the repo, and ignored by git when git can tell. */
export function assertOutIgnored(out: string, repo = REPO_ROOT): void {
  const rel = relative(resolve(repo, 'assets/vendor'), resolve(out));
  if (rel.startsWith('..') || rel.startsWith(sep) || resolve(out) === resolve(repo))
    throw new Error(
      `refusing to write pack-derived art to ${out}: the output must be inside assets/vendor/ (gitignored)`,
    );
  try {
    execFileSync('git', ['check-ignore', '-q', join(resolve(out), 'x.png')], {
      cwd: repo,
      stdio: 'ignore',
    });
  } catch (e) {
    const code = (e as { status?: number }).status;
    if (code === 1)
      throw new Error(`refusing to write: ${out} is not ignored by git (assets/vendor/ must be)`);
    /* git missing or not a repo (exit 128 / ENOENT): the path rule above still holds */
  }
}

export interface ImportOpts {
  source: PackSource;
  recipes: Recipe[];
  out: string;
  dryRun: boolean;
  repo?: string;
}

/** Validate every recipe against the pack and, unless dry-run, compose and write the layers. Never throws on pack problems: they land in the report. */
export function runImport(o: ImportOpts): ImportReport {
  const report: ImportReport = {
    source: o.source.label,
    out: o.out,
    dryRun: o.dryRun,
    recipes: [],
    ok: true,
  };
  if (!o.dryRun) assertOutIgnored(o.out, o.repo);
  const sheetCache = new Map<string, ReturnType<typeof decodePng>>();
  const sheet = (path: string) => {
    let s = sheetCache.get(path);
    if (!s) {
      s = decodePng(o.source.read(path));
      sheetCache.set(path, s);
    }
    return s;
  };
  for (const r of o.recipes) {
    const rep: RecipeReport = { id: r.id, files: [], problems: [], written: [] };
    report.recipes.push(rep);
    for (const f of neededFiles(r)) {
      const found = o.source.has(f);
      rep.files.push({ path: f, found });
      if (!found) rep.problems.push(`missing in pack: ${f}`);
    }
    if (rep.problems.length === 0) {
      try {
        rep.problems.push(
          ...checkSpriteBounds(r, (k) => {
            const p = r.sheets[k];
            const s = p ? sheet(p) : undefined;
            return s ? { w: s.w, h: s.h } : undefined;
          }),
        );
      } catch (e) {
        rep.problems.push(`cannot read a sheet: ${(e as Error).message}`);
      }
    }
    if (rep.problems.length) {
      report.ok = false;
      continue;
    }
    if (o.dryRun) continue;
    const layers = compose(r, (k) => sheet(r.sheets[k]!));
    const dir = join(o.out, r.id);
    mkdirSync(dir, { recursive: true });
    const files: Partial<Record<LayerName, string>> = {};
    for (const [name, raster] of Object.entries(layers) as [LayerName, NonNullable<(typeof layers)[LayerName]>][]) {
      writeFileSync(join(dir, `${name}.png`), encodePng(raster));
      files[name] = `${name}.png`;
      rep.written.push(`${r.id}/${name}.png`);
    }
    const manifest: SkinManifest = {
      version: 1,
      id: r.id,
      scene: r.scene,
      title: r.title,
      credit: r.credit,
      size: r.size,
      layers: files,
      layout: r.layout,
    };
    writeFileSync(join(dir, 'skin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    rep.written.push(`${r.id}/skin.json`);
    const indexPath = join(o.out, 'index.json');
    let index: SkinIndex = { version: 1, skins: {} };
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as SkinIndex;
    } catch {
      /* first run */
    }
    index.skins[r.scene] = `${r.id}/skin.json`;
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
  return report;
}

export const DEFAULT_OUT = resolve(REPO_ROOT, SKIN_ROOT);
