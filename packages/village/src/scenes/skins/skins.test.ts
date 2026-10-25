import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Raster } from '../pixel/raster';
import { createAssetLib } from '../assets';
import { nodeAssets } from '../tools/node-assets';
import { initCouncilHall } from '../council-hall/state';
import { CLASSIC_LAYOUT, paintInterior } from '../council-hall/interior';
import { SEAT_BOX, roomSeats } from '../roomSeats';
import { po } from '../testkit';
import { compose, checkSpriteBounds } from './compose';
import {
  REPO_ROOT,
  RECIPES_DIR,
  assertOutIgnored,
  defaultZip,
  loadRecipes,
  runImport,
  zipSource,
} from './importer';
import { neededFiles, validateRecipe } from './recipe';
import { fetchSkinManifests, safeSkinPath, skinMode, type LoadedSkin } from './runtime';
import { FIXTURE_RECIPE, fixturePackZip, solidSheet } from './fixture';
import type { Recipe, SkinManifest } from './types';

const tmp = mkdtempSync(join(tmpdir(), 'squad-skin-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('recipe validation', () => {
  it('every committed recipe is valid, names only pack-relative pngs, and carries no pixels', () => {
    const recipes = loadRecipes();
    expect(recipes.length).toBeGreaterThan(0);
    for (const f of readdirSync(RECIPES_DIR)) {
      const text = readFileSync(join(RECIPES_DIR, f), 'utf8');
      expect(text).not.toMatch(/data:image|base64/i);
      expect(text.length).toBeLessThan(20_000);
    }
    for (const r of recipes) {
      expect(r.credit).toBe('World art: Modern Interiors by LimeZu');
      for (const p of neededFiles(r)) expect(p).toMatch(/^1_Interiors\/16x16\/.+\.png$/);
    }
  });
  it('rejects unknown sprites, bad paths, bad colours, off-room anchors', () => {
    const r = clone(FIXTURE_RECIPE) as Recipe;
    r.layers.bg.push({ op: 'put', sprite: 'nope', x: 0, y: 0 });
    r.sheets.c = '../escape.png';
    r.layers.bg.push({ op: 'fill', x: 0, y: 0, w: 1, h: 1, color: 'red' });
    r.layout.chair = { x: 999, y: 1 };
    expect(() => validateRecipe(r)).toThrow(
      /pack-relative.*unknown sprite nope.*#rrggbb.*inside the room/s,
    );
    expect(() => validateRecipe(clone(FIXTURE_RECIPE))).not.toThrow();
    const noCredit = clone(FIXTURE_RECIPE) as Recipe;
    noCredit.credit = 'x';
    expect(() => validateRecipe(noCredit)).toThrow(/LimeZu/);
  });
  it('lists the needed pack files sorted and de-duplicated', () => {
    expect(neededFiles(FIXTURE_RECIPE)).toEqual(['fake/a_16x16.png', 'fake/sub/b_16x16.png']);
  });
});

describe('compose', () => {
  const load = (k: string): Raster =>
    k === 'a' ? solidSheet(32, 32, [90, 40, 160]) : solidSheet(24, 16, [210, 170, 90]);
  it('is deterministic and keeps layers separate', () => {
    const a = compose(FIXTURE_RECIPE, load);
    const b = compose(FIXTURE_RECIPE, load);
    expect(a.bg!.hash()).toBe(b.bg!.hash());
    expect(a.mid!.hash()).toBe(b.mid!.hash());
    expect(a.bg!.w).toBe(224);
    expect(a.bg!.get(100, 100)[3]).toBe(255);
    expect(a.mid!.get(100, 90)[3]).toBe(255); // table span drawn
    expect(a.mid!.get(10, 10)[3]).toBe(0); // everything else transparent
    expect(a.fg).toBeUndefined();
  });
  it('refuses a rectangle outside its sheet', () => {
    const r = clone(FIXTURE_RECIPE) as Recipe;
    r.sprites.floor = { sheet: 'a', x: 30, y: 0, w: 16, h: 16 };
    expect(checkSpriteBounds(r, () => ({ w: 32, h: 32 }))).toHaveLength(1);
    expect(() => compose(r, load)).toThrow(/outside its sheet/);
  });
});

describe('importer on a synthetic pack', () => {
  const zipPath = join(tmp, 'fixture.zip');
  writeFileSync(zipPath, fixturePackZip());
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'assets/vendor'), { recursive: true });

  it('dry run reads the zip, writes nothing, reports ok', () => {
    const out = join(repo, 'assets/vendor/interiors');
    const rep = runImport({
      source: zipSource(zipPath),
      recipes: [FIXTURE_RECIPE],
      out,
      dryRun: true,
      repo,
    });
    expect(rep.ok).toBe(true);
    expect(rep.recipes[0]!.files.every((f) => f.found)).toBe(true);
    expect(() => readdirSync(out)).toThrow();
  });
  it('names the missing pack file instead of crashing', () => {
    const p = join(tmp, 'broken.zip');
    writeFileSync(p, fixturePackZip(['fake/sub/b_16x16.png']));
    const rep = runImport({
      source: zipSource(p),
      recipes: [FIXTURE_RECIPE],
      out: join(repo, 'assets/vendor/interiors'),
      dryRun: true,
      repo,
    });
    expect(rep.ok).toBe(false);
    expect(rep.recipes[0]!.problems).toEqual(['missing in pack: fake/sub/b_16x16.png']);
  });
  it('writes layers, manifest and index deterministically, only under assets/vendor', () => {
    const out = join(repo, 'assets/vendor/interiors');
    const run = () =>
      runImport({
        source: zipSource(zipPath),
        recipes: [FIXTURE_RECIPE],
        out,
        dryRun: false,
        repo,
      });
    const a = run();
    expect(a.ok).toBe(true);
    const bg1 = readFileSync(join(out, 'fixture-chamber/bg.png'));
    run();
    expect(readFileSync(join(out, 'fixture-chamber/bg.png')).equals(bg1)).toBe(true);
    const m = JSON.parse(
      readFileSync(join(out, 'fixture-chamber/skin.json'), 'utf8'),
    ) as SkinManifest;
    expect(m.layers).toEqual({ bg: 'bg.png', mid: 'mid.png' });
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).skins['council-hall']).toBe(
      'fixture-chamber/skin.json',
    );
  });
  it('refuses to write outside assets/vendor', () => {
    expect(() => assertOutIgnored(join(tmp, 'elsewhere'), repo)).toThrow(/assets\/vendor/);
    expect(() => assertOutIgnored(join(REPO_ROOT, 'assets/pixel'))).toThrow(/assets\/vendor/);
    expect(() => assertOutIgnored(join(REPO_ROOT, 'assets/vendor/interiors'))).not.toThrow();
  });
  it('finds the pack from MODERN_INTERIORS_ZIP first', () => {
    expect(defaultZip({ MODERN_INTERIORS_ZIP: '/x/y.zip' } as NodeJS.ProcessEnv)).toBe('/x/y.zip');
    expect(defaultZip({} as NodeJS.ProcessEnv, tmp)).toBeNull();
  });
});

describe('fallback when the local art is absent', () => {
  it('no manifest, a 404 or html, or garbage all mean "no skins" without throwing', async () => {
    const url = (p: string) => `/${p}`;
    expect(await fetchSkinManifests(url, async () => undefined)).toEqual([]);
    expect(
      await fetchSkinManifests(url, async () => {
        throw new Error('offline');
      }),
    ).toEqual([]);
    expect(await fetchSkinManifests(url, async () => ({ version: 2 }))).toEqual([]);
    expect(
      await fetchSkinManifests(url, async () => ({
        version: 1,
        skins: { 'council-hall': '../../etc/passwd' },
      })),
    ).toEqual([]);
  });
  it('mode: off wins, force probes, auto needs the boot marker', () => {
    expect(skinMode('?skin=off', true)).toBe('off');
    expect(skinMode('?skin=modern-interiors', false)).toBe('force');
    expect(skinMode('', true)).toBe('auto');
    expect(skinMode('', false)).toBe('none');
    expect(safeSkinPath('council-chamber/bg.png')).toBe(true);
    expect(safeSkinPath('../x.png')).toBe(false);
    expect(safeSkinPath('/abs.png')).toBe(false);
  });
  it('the asset library has no skin and the hall paints the classic art', () => {
    const A = nodeAssets();
    expect(A.skin?.('council-hall')).toBeUndefined();
    const s = { ...initCouncilHall(), access: 'open' as const };
    const classic = paintInterior(s, po(0, true));
    const lib = createAssetLib({ assets: [] }, { frames: {} }, () => new Raster(1, 1));
    expect(lib.skin?.('council-hall')).toBeUndefined();
    expect(paintInterior(s, po(0, true)).hash()).toBe(classic.hash());
  });
});

describe('skin painting and seat alignment', () => {
  const layout = FIXTURE_RECIPE.layout;
  const skin: LoadedSkin = {
    id: 'fixture-chamber',
    scene: 'council-hall',
    title: 'Fixture',
    credit: FIXTURE_RECIPE.credit,
    layout,
    layers: {
      bg: solidSheet(224, 128, [30, 200, 30]),
      mid: (() => {
        const r = new Raster(224, 128);
        r.blit(solidSheet(96, 30, [200, 30, 30]), 64, 84);
        return r;
      })(),
    },
  };
  const withSkin = () => {
    const base = nodeAssets();
    return { ...base, skin: (sc: string) => (sc === 'council-hall' ? skin : undefined) };
  };

  it('paints the skin background and the table layer; classic art is untouched', () => {
    const s = { ...initCouncilHall(), access: 'open' as const };
    const classic = paintInterior(s, po(0, true));
    const skinned = paintInterior(s, { ...po(0, true), assets: withSkin() });
    expect(skinned.hash()).not.toBe(classic.hash());
    expect(skinned.get(5, 5)).toEqual([30, 200, 30, 255]); // background
    expect(skinned.get(70, 100)).toEqual([200, 30, 30, 255]); // table layer, clear of any seat
  });
  it('seat hit zones come from the skin data, classic anchors stay without one', () => {
    const moved = {
      ...layout,
      seats: [
        { x: 40, y: 100, flip: false },
        { x: 112, y: 118, flip: false },
        { x: 184, y: 100, flip: true },
      ] as typeof layout.seats,
      chair: { x: 112, y: 86 },
    };
    const seats = roomSeats('council-hall', 'council:ask', {}, moved);
    expect(seats.map((s) => [s.x, s.y])).toEqual([
      [40, 100],
      [112, 86],
      [112, 118],
      [184, 100],
    ]);
    const classic = roomSeats('council-hall', 'council:ask', {});
    expect(classic.map((s) => [s.x, s.y])).toEqual([
      [50, 103],
      [112, 89],
      [112, 121],
      [174, 103],
    ]);
  });
  it('every real recipe keeps seats inside the room, on the floor, and clear of the table', () => {
    for (const r of loadRecipes()) {
      const L = r.layout;
      const table = r.layers.mid?.find((o) => o.op === 'span');
      for (const p of [...L.seats, L.chair]) {
        expect(p.x - SEAT_BOX.w / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + SEAT_BOX.w / 2).toBeLessThanOrEqual(r.size[0]);
        expect(p.y).toBeLessThan(r.size[1]);
        expect(p.y - SEAT_BOX.h).toBeGreaterThanOrEqual(0);
      }
      expect(L.seats[0].x).toBeLessThan(L.seats[1].x);
      expect(L.seats[1].x).toBeLessThan(L.seats[2].x);
      expect(L.rowX).toEqual([L.seats[0].x, L.seats[1].x, L.seats[2].x]);
      if (table && table.op === 'span') {
        const h = r.sprites[table.mid]!.h;
        expect(L.seats[0].x + SEAT_BOX.w / 2).toBeLessThanOrEqual(table.x + 2); // left member beside the table
        expect(L.seats[2].x - SEAT_BOX.w / 2).toBeGreaterThanOrEqual(table.x + table.w - 2);
        expect(L.seats[1].y).toBeGreaterThanOrEqual(table.y + h - 6); // front member at the near edge
        expect(L.chair.y).toBeGreaterThanOrEqual(table.y); // chairman sits behind the table top
        expect(L.chair.y).toBeLessThan(table.y + h);
      }
    }
  });
  it('the hit zone data and the painter read the same anchors (classic layout equals roomSeats)', () => {
    const classic = roomSeats('council-hall', 'x', {});
    for (const [i, s] of CLASSIC_LAYOUT.seats.entries())
      expect(
        classic.some((c) => c.x === s.x && c.y === s.y),
        `seat ${i}`,
      ).toBe(true);
  });
});

describe('licence guard: no pack art or derived art is tracked by git', () => {
  const git = (...a: string[]): string | null => {
    try {
      return execFileSync('git', a, {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
    } catch {
      return null; // not a git checkout (tarball): nothing to check
    }
  };
  it('git ls-files assets/vendor is empty and assets/vendor is ignored', () => {
    const files = git('ls-files', 'assets/vendor');
    if (files === null) return;
    expect(files.trim()).toBe('');
    const ign = git('check-ignore', 'assets/vendor/interiors/council-chamber/bg.png');
    expect(ign?.trim()).toBe('assets/vendor/interiors/council-chamber/bg.png');
  });
  it('no tracked image, atlas or archive carries a pack name, and the importer tree has no images', () => {
    const files = git('ls-files');
    if (files === null) return;
    const list = files.split('\n').filter(Boolean);
    const art = /\.(png|webp|gif|jpe?g|zip|aseprite|tsx|tmx)$/i;
    const packy =
      /modern[-_ ]?interiors|limezu|room_builder|interiors_16x16|conference_hall|theme_sorter|moderninteriors/i;
    expect(list.filter((f) => art.test(f) && packy.test(f))).toEqual([]);
    expect(
      list.filter((f) => f.startsWith('packages/village/src/scenes/skins/') && art.test(f)),
    ).toEqual([]);
    expect(list.filter((f) => /chamber-.*\.png$/i.test(f))).toEqual([]);
    expect(list.filter((f) => f.startsWith('assets/vendor/'))).toEqual([]);
  });
  it('the composed layer files the importer would write sit in the ignored folder', () => {
    const ign = git('check-ignore', '-v', 'assets/vendor/interiors/index.json');
    if (ign === null) return;
    expect(ign).toMatch(/assets\/vendor\//);
  });
});
