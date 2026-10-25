/* global process, console */
// Local-only importer for the licensed LimeZu "Modern Interiors" pack (license forbids redistribution).
// Copies the files named in a recipe into the gitignored assets/vendor/modern-interiors/ and writes the
// gitignored assets/interior/manifest.local.json that the engine deep-merges over the placeholder manifest.
//
//   node scripts/import-modern-interiors.mjs --from ~/Downloads/Modern_Interiors --recipe recipe.json
//
// The recipe maps pack files to engine roles (the pack's real folder layout is unverified until it is
// downloaded, so nothing is guessed here). See assets/interior/vendor-recipe.example.json.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const from = arg('from');
const recipePath = arg('recipe');
if (!from || !recipePath) {
  console.error('usage: import-modern-interiors.mjs --from <pack dir> --recipe <recipe.json>');
  process.exit(1);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vendor = join(repo, 'assets/vendor/modern-interiors');
const recipe = JSON.parse(readFileSync(resolve(recipePath), 'utf8'));

const need = (rel) => {
  const p = resolve(from, rel);
  if (!existsSync(p)) {
    console.error(`missing in pack: ${rel}`);
    process.exit(1);
  }
  return p;
};
const put = (rel, dest) => {
  const target = join(vendor, dest);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(need(rel), target);
  return `vendor/modern-interiors/${dest}`;
};

const local = { pack: 'modern-interiors' };
if (recipe.tileset) {
  // tileset.def is an engine-format JSON ({name,tileSize:16,image,columns,tiles:{name:index}}) you author once.
  local.tileset = { image: put(recipe.tileset.image, 'tileset.png'), def: put(recipe.tileset.def, 'tileset.json') };
}
if (recipe.props) {
  // props.def: {props:{name:{x,y,w,h,foot:{x,y,w,h},tall}}} for the packed atlas image.
  local.props = { image: put(recipe.props.image, 'props.png'), def: put(recipe.props.def, 'props.json') };
}
if (recipe.characters) {
  const c = recipe.characters;
  local.characters = {
    ...(c.frame && { frame: c.frame }),
    ...(c.anchor && { anchor: c.anchor }),
    ...(c.fps && { fps: c.fps }),
    ...(c.anims && { anims: c.anims }),
    cast: c.cast.map((s) => ({ id: s.id, image: put(s.image, `characters/${basename(s.image)}`), ...(s.frame && { frame: s.frame }) })),
    ...(c.player && { player: c.player }),
  };
}
if (recipe.maps) {
  local.maps = {};
  for (const [id, rel] of Object.entries(recipe.maps)) local.maps[id] = put(rel, `maps/${basename(rel)}`);
}
const out = join(repo, 'assets/interior/manifest.local.json');
writeFileSync(out, JSON.stringify(local, null, 2) + '\n');
console.log(`wrote ${out}. Delete it to return to the placeholder pack. Credit: "World art: Modern Interiors by LimeZu".`);
