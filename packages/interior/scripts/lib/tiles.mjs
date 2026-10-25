// Terrain tile builders. Every function is deterministic. `C` maps palette names to RGBA.
//
// WALL GEOMETRY (3/4 view, light from top-left)
//   A horizontal wall is THREE map rows: wall.cap.* (flat top surface), wall.face.hi.* (upper face),
//   wall.face.* (lower face, has wainscot/skirting and sits directly above the floor row).
//   A vertical wall (divider between side-by-side rooms) is a CAP-ONLY column. Wherever a cap run
//   ends towards the south (a horizontal wall, a stub, the jamb above a side doorway) the two face
//   rows continue underneath it. wall.cap.N is a 4-neighbour autotile, mask N=1 E=2 S=4 W=8 meaning
//   "another cap tile exists in that direction"; the face rows count as "no cap" so a cap whose
//   south side is a face reads as a horizontal run (mask has S=0, lip drawn).
//   Inner (concave) corners: tiles that connect to N and E / N and W get a corner notch pixel so the
//   outline of the floor corner closes. Dividers hanging from a horizontal wall start in the cap
//   row and simply replace the face tiles in their column with cap tiles.
import { Pix } from './png.mjs';
import { rng, hline, vline, darken, shadowCol, roundCorners } from './draw.mjs';

export const THEMES = {
  // plaster (hi, body, shade) + wainscot (rail, panel, line, base)
  commons: {
    hi: 'peach-hi',
    body: 'peach',
    sh: 'peach-sh',
    rail: 'wood-hi',
    panel: 'wood-lit',
    line: 'wood-mid',
    base: 'wood-dark',
    stripe: 'peach-sh',
  },
  class: {
    hi: 'teal-hi',
    body: 'teal',
    sh: 'teal-sh',
    rail: 'trim-hi',
    panel: 'trim',
    line: 'trim-sh',
    base: 'trim-dk',
    stripe: 'teal-sh',
  },
  library: {
    hi: 'moss-hi',
    body: 'moss',
    sh: 'moss-sh',
    rail: 'wood-lit',
    panel: 'wood-dark',
    line: 'wood-deep',
    base: 'wood-deep',
    stripe: 'moss-sh',
  },
  council: {
    hi: 'plum-hi',
    body: 'plum',
    sh: 'plum-sh',
    rail: 'glow',
    panel: 'wine',
    line: 'wine-dk',
    base: 'wine-dk',
    stripe: 'plum-sh',
  },
  hall: {
    hi: 'trim-hi',
    body: 'trim',
    sh: 'trim-sh',
    rail: 'teal-hi',
    panel: 'teal',
    line: 'teal-sh',
    base: 'teal-dk',
    stripe: 'trim-sh',
  },
};

export function buildTiles(C) {
  const out = [];
  const add = (name, pix) => {
    if (pix.w !== 16 || pix.h !== 16) throw new Error(`tile ${name} is ${pix.w}x${pix.h}`);
    out.push({ name, pix });
  };
  const tile = (name, fn) => {
    const p = new Pix(16, 16);
    fn(p);
    add(name, p);
  };
  const clear = [0, 0, 0, 0];

  // ---------------------------------------------------------------- floors
  // Commons: pale birch planks (cream/tan), two 8px planks per tile, staggered end joints, three variants.
  const plankH = (p, cols, joints, seed) => {
    const r = rng(seed);
    for (let j = 0; j < 2; j++) {
      const y0 = j * 8;
      p.rect(0, y0, 16, 8, j ? cols.b : cols.a);
      hline(p, 0, y0 + 7, 16, cols.seam);
      hline(p, 0, y0, 16, j ? cols.hiB : cols.hiA);
      const jx = joints[j];
      if (jx != null) {
        vline(p, jx, y0, 7, cols.seam);
        p.set(jx + 1, y0 + 1, cols.hiB);
      }
      for (let k = 0; k < 3; k++) {
        const gx = 1 + Math.floor(r() * 11);
        const gy = y0 + 2 + Math.floor(r() * 4);
        if (jx != null && Math.abs(gx - jx) < 3) continue;
        hline(p, gx, gy, 2 + Math.floor(r() * 2), j ? cols.grainB : cols.grainA);
      }
    }
  };
  const commons = {
    a: C['cream-mid'],
    b: C['cream'],
    seam: C['tan'],
    hiA: C['cream'],
    hiB: C['cream-hi'],
    grainA: C['tan'],
    grainB: C['cream-mid'],
  };
  tile('floor.commons.a', (p) => plankH(p, commons, [5, 12], 11));
  tile('floor.commons.b', (p) => plankH(p, commons, [11, 3], 23));
  tile('floor.commons.c', (p) => plankH(p, commons, [null, 8], 37));

  // Classroom: two-tone checker. Each map tile is one big square; a/b alternate.
  const square = (p, base, hi, shade, grout, specks) => {
    p.rect(0, 0, 16, 16, base);
    hline(p, 0, 0, 16, hi);
    vline(p, 0, 0, 16, hi);
    hline(p, 1, 14, 15, shade);
    vline(p, 14, 1, 14, shade);
    hline(p, 0, 15, 16, grout);
    vline(p, 15, 0, 16, grout);
    for (const [x, y] of specks) p.set(x, y, shade);
  };
  tile('floor.class.a', (p) =>
    square(p, C['cream'], C['cream-hi'], C['cream-mid'], C['tan'], [
      [5, 6],
      [6, 6],
      [11, 10],
    ]),
  );
  tile('floor.class.b', (p) =>
    square(p, C['teal-hi'], C['trim-hi'], C['teal'], C['teal'], [
      [9, 4],
      [4, 11],
      [5, 11],
    ]),
  );

  // Council: wine carpet with woven motif, wood surround, inset border pieces.
  const carpet = (p, v) => {
    p.rect(0, 0, 16, 16, C['wine']);
    const motif = (cx, cy) => {
      p.set(cx, cy, C['wine-hi']);
      p.set(cx - 1, cy, C['wine-hi']);
      p.set(cx + 1, cy, C['wine-hi']);
      p.set(cx, cy - 1, C['wine-hi']);
      p.set(cx, cy + 1, C['wine-hi']);
      p.set(cx - 1, cy - 1, C['wine-dk']);
      p.set(cx + 1, cy - 1, C['wine-dk']);
      p.set(cx - 1, cy + 1, C['wine-dk']);
      p.set(cx + 1, cy + 1, C['wine-dk']);
    };
    if (v === 'a') {
      motif(4, 4);
      motif(12, 12);
      p.set(12, 4, C['wine-dk']);
      p.set(4, 12, C['wine-dk']);
    } else {
      motif(12, 4);
      motif(4, 12);
      p.set(4, 4, C['wine-dk']);
      p.set(12, 12, C['wine-dk']);
    }
  };
  tile('floor.council.a', (p) => carpet(p, 'a'));
  tile('floor.council.b', (p) => carpet(p, 'b'));
  tile('floor.council.wood', (p) => {
    for (let j = 0; j < 2; j++) {
      const y0 = j * 8;
      p.rect(0, y0, 16, 8, j ? C['wood-dark'] : C['wood']);
      hline(p, 0, y0, 16, j ? C['wood'] : C['wood-mid']);
      hline(p, 0, y0 + 7, 16, C['wood-deep']);
    }
    hline(p, 3, 4, 3, C['wood-dark']);
    hline(p, 10, 12, 3, C['wood']);
  });
  // Carpet border: bands measured from the outer edge of the carpet (d = 0 is the outside).
  const border = (name, open) => {
    tile(name, (p) => {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const ds = [];
          if (open.n) ds.push(y);
          if (open.s) ds.push(15 - y);
          if (open.w) ds.push(x);
          if (open.e) ds.push(15 - x);
          const d = Math.min(...ds);
          let c;
          if (d < 3) c = (y & 7) === 7 ? C['wood-deep'] : (y >> 3) & 1 ? C['wood-dark'] : C['wood'];
          else if (d === 3) c = C['wine-dk'];
          else if (d === 4) c = C['glow'];
          else if (d === 5) c = C['wine-dk'];
          else if (d === 6) c = C['wine-hi'];
          else c = C['wine'];
          p.set(x, y, c);
        }
      // stitched dots in the wine field
      for (let i = 2; i < 14; i += 4) {
        const pts = [];
        if (open.n) pts.push([i, 8]);
        if (open.s) pts.push([i, 7]);
        if (open.w) pts.push([8, i]);
        if (open.e) pts.push([7, i]);
        for (const [x, y] of pts)
          if (p.get(x, y).join() === C['wine'].join()) p.set(x, y, C['wine-hi']);
      }
    });
  };
  border('floor.council.border.n', { n: true });
  border('floor.council.border.s', { s: true });
  border('floor.council.border.w', { w: true });
  border('floor.council.border.e', { e: true });
  border('floor.council.border.nw', { n: true, w: true });
  border('floor.council.border.ne', { n: true, e: true });
  border('floor.council.border.sw', { s: true, w: true });
  border('floor.council.border.se', { s: true, e: true });

  // Library: dark vertical planks (8px wide), seams wood-deep.
  const plankV = (p, joints, seed) => {
    const r = rng(seed);
    for (let j = 0; j < 2; j++) {
      const x0 = j * 8;
      p.rect(x0, 0, 8, 16, j ? C['wood-dark'] : C['wood']);
      vline(p, x0 + 7, 0, 16, C['wood-deep']);
      vline(p, x0, 0, 16, j ? C['wood'] : C['wood-mid']);
      const jy = joints[j];
      if (jy != null) {
        hline(p, x0, jy, 7, C['wood-deep']);
        hline(p, x0 + 1, jy + 1, 6, j ? C['wood'] : C['wood-mid']);
      }
      for (let k = 0; k < 1; k++) {
        const gy = 1 + Math.floor(r() * 12);
        const gx = x0 + 3 + Math.floor(r() * 2);
        if (jy != null && Math.abs(gy - jy) < 3) continue;
        vline(p, gx, gy, 2, j ? C['wood-deep'] : C['wood-dark']);
      }
    }
  };
  tile('floor.library.a', (p) => plankV(p, [4, 11], 5));
  tile('floor.library.b', (p) => plankV(p, [12, 5], 17));

  // Corridor / hall: greige stone slabs, lit top-left, grouted bottom-right.
  const slab = (p, v) => {
    p.rect(0, 0, 16, 16, C['trim-sh']);
    hline(p, 0, 0, 16, C['trim']);
    vline(p, 0, 0, 16, C['trim']);
    hline(p, 1, 1, 14, C['trim-hi']);
    vline(p, 1, 1, 14, C['trim-hi']);
    hline(p, 0, 15, 16, C['trim-dk']);
    vline(p, 15, 0, 16, C['trim-dk']);
    hline(p, 2, 14, 13, C['trim-dk']);
    p.rect(2, 2, 12, 12, C['trim-sh']);
    hline(p, 2, 2, 12, C['trim']);
    for (const [x, y] of v === 'a'
      ? [
          [5, 5],
          [10, 9],
          [11, 9],
          [4, 11],
        ]
      : [
          [9, 4],
          [4, 8],
          [5, 8],
          [11, 11],
          [7, 12],
        ])
      p.set(x, y, C['trim-dk']);
    if (v === 'b') {
      p.set(8, 6, C['trim-dk']);
      p.set(9, 7, C['trim-dk']);
    }
  };
  tile('floor.corridor', (p) => slab(p, 'a'));
  tile('floor.corridor.b', (p) => slab(p, 'b'));

  // Door threshold: a cream stone slab, the neutral floor between two differently floored rooms.
  const stoneSlab = (p) => {
    p.rect(0, 0, 16, 16, C['cream-mid']);
    hline(p, 0, 0, 16, C['cream']);
    vline(p, 0, 0, 16, C['cream']);
    hline(p, 0, 15, 16, C['tan']);
    vline(p, 15, 0, 16, C['tan']);
    for (const [x, y] of [
      [4, 4],
      [11, 9],
      [6, 12],
    ])
      p.set(x, y, C['tan']);
  };
  tile('floor.threshold', stoneSlab);

  tile('void', (p) => p.rect(0, 0, 16, 16, C['line']));

  // ---------------------------------------------------------------- wall caps
  const capTile = (m) => {
    const p = new Pix(16, 16);
    p.rect(0, 0, 16, 16, C['trim']);
    const oN = !(m & 1),
      oE = !(m & 2),
      oS = !(m & 4),
      oW = !(m & 8);
    if (oN) hline(p, 0, 1, 16, C['trim-hi']);
    if (oW) vline(p, 1, 0, 16, C['trim-hi']);
    if (oE) vline(p, 14, 0, 16, C['trim-sh']);
    if (oS) {
      hline(p, 0, 13, 16, C['trim-sh']);
      hline(p, 0, 14, 16, C['trim-dk']);
    }
    if (oN) hline(p, 0, 0, 16, C['line']);
    if (oW) vline(p, 0, 0, 16, C['line']);
    if (oE) vline(p, 15, 0, 16, C['line']);
    if (oS) hline(p, 0, 15, 16, C['line']);
    // fine tile joints on the walking-surface-less top: a faint brick line keeps big caps from looking flat
    // coping groove through the middle of every run (keeps wide caps from reading as flat paper)
    const g = C['trim-sh'];
    if (m & 2) hline(p, 8, 7, 8, g);
    if (m & 8) hline(p, 0, 7, 8, g);
    if (m & 1) vline(p, 7, 0, 8, g);
    if (m & 4) vline(p, 7, 8, 8, g);
    // concave corner notches (the floor corner on the north side)
    if (!oN && !oE) {
      p.set(15, 0, C['line']);
      p.set(14, 0, C['trim-sh']);
    }
    if (!oN && !oW) {
      p.set(0, 0, C['line']);
      p.set(1, 0, C['trim-hi']);
    }
    return p;
  };
  for (let m = 0; m < 16; m++) add(`wall.cap.${m}`, capTile(m));

  // ---------------------------------------------------------------- wall faces
  // kind: plain | skirt | window | left-end | right-end | pillar   (lower face, hi=false)
  //       plain | window | left-end | right-end | pillar            (upper face, hi=true)
  const faceTile = (th, hi, kind) => {
    const T = THEMES[th];
    const p = new Pix(16, 16);
    const body = C[T.body],
      sh = C[T.sh],
      hl = C[T.hi];
    p.rect(0, 0, 16, 16, body);
    // wallpaper stripes
    for (let y = 0; y < 16; y++) {
      p.set(3, y, hl);
      p.set(11, y, sh);
    }
    if (hi) {
      // crown moulding under the cap lip
      hline(p, 0, 0, 16, C['trim-hi']);
      hline(p, 0, 1, 16, C['trim']);
      hline(p, 0, 2, 16, sh);
      hline(p, 0, 3, 16, body);
    }
    const wainscot = () => {
      for (let y = 10; y < 16; y++) {
        let c = y === 10 ? C[T.rail] : y === 15 ? C[T.base] : C[T.panel];
        hline(p, 0, y, 16, c);
      }
      hline(p, 0, 11, 16, C[T.hi === 'trim-hi' ? 'teal' : T.rail]);
      hline(p, 0, 9, 16, sh);
      for (const x of [7, 15]) vline(p, x, 12, 3, C[T.line]);
      hline(p, 0, 11, 16, C[T.panel]);
      // rail highlight/shade
      hline(p, 0, 10, 16, C[T.rail]);
    };
    if (!hi) {
      p.rect(0, 0, 16, 9, body);
      for (let y = 0; y < 9; y++) {
        p.set(3, y, hl);
        p.set(11, y, sh);
      }
      if (kind !== 'plain') wainscot();
      else hline(p, 0, 15, 16, sh);
    }
    if (kind === 'window') {
      // window frame spans both rows: x 2..13; the hi tile has the valance + top, the lo tile the sill.
      const fr = C['trim-hi'],
        frs = C['trim-sh'];
      if (hi) {
        p.rect(0, 4, 16, 12, body);
        for (let y = 4; y < 16; y++) {
          p.set(3, y, hl);
          p.set(11, y, sh);
        }
        // frame
        p.rect(2, 4, 12, 12, C['line']);
        p.rect(3, 5, 10, 11, fr);
        // glass 4..11 x 6..15 with sky + cloud
        p.rect(4, 6, 8, 10, C['sky']);
        hline(p, 4, 6, 8, C['sky-hi']);
        p.rect(5, 8, 3, 1, C['sky-hi']);
        p.rect(6, 7, 2, 1, C['sky-hi']);
        p.rect(9, 10, 2, 1, C['sky-hi']);
        // muntin
        vline(p, 7, 6, 10, fr);
        vline(p, 8, 6, 10, frs);
        // curtain valance
        p.rect(2, 4, 12, 3, C[T.panel === 'trim' ? 'teal' : T.panel]);
        hline(p, 2, 4, 12, C['line']);
        hline(
          p,
          3,
          5,
          10,
          C[
            T.rail === 'glow'
              ? 'wine-hi'
              : T.rail === 'wood-hi'
                ? 'orange'
                : T.rail === 'wood-lit'
                  ? 'moss-hi'
                  : 'teal-hi'
          ],
        );
        for (const x of [3, 5, 7, 9, 11]) p.set(x, 7, C['line']);
        p.set(2, 7, C['line']);
        p.set(13, 7, C['line']);
      } else {
        // lower: glass rows 0..5, sill 6..8, wall continues
        p.rect(2, 0, 12, 7, C['line']);
        p.rect(3, 0, 10, 7, fr);
        p.rect(4, 0, 8, 6, C['sky']);
        p.rect(4, 3, 8, 3, C['sky']);
        p.rect(5, 1, 2, 1, C['sky-hi']);
        p.rect(9, 3, 2, 1, C['sky-hi']);
        vline(p, 7, 0, 6, fr);
        vline(p, 8, 0, 6, frs);
        hline(p, 4, 5, 8, frs);
        // sill (lit top, shaded front)
        p.rect(1, 6, 14, 3, C['line']);
        hline(p, 2, 6, 12, C['trim-hi']);
        hline(p, 2, 7, 12, C['trim']);
        hline(p, 2, 8, 12, C['trim-sh']);
        // curtain tails
        vline(p, 3, 0, 6, C[T.panel === 'trim' ? 'teal' : T.panel]);
        vline(p, 12, 0, 6, C[T.panel === 'trim' ? 'teal' : T.panel]);
      }
    }
    if (kind === 'left-end' || kind === 'pillar') {
      vline(p, 0, 0, 16, C['line']);
      vline(p, 1, hi ? 3 : 0, hi ? 13 : 16, sh);
    }
    if (kind === 'right-end' || kind === 'pillar') {
      vline(p, 15, 0, 16, C['line']);
      vline(p, 14, hi ? 3 : 0, hi ? 13 : 16, sh);
    }
    // wall base: floor contact line
    if (!hi) hline(p, kind === 'left-end' || kind === 'pillar' ? 1 : 0, 15, 16, C[T.base]);
    return p;
  };
  const faceKinds = {
    lo: ['plain', 'skirt', 'window', 'left-end', 'right-end', 'pillar'],
    hi: ['plain', 'window', 'left-end', 'right-end', 'pillar'],
  };
  for (const th of Object.keys(THEMES)) {
    const pre = th === 'commons' ? 'wall.face' : `wall.face.${th}`;
    for (const k of faceKinds.lo)
      add(
        `${pre}.${k}`,
        faceTile(
          th,
          false,
          k === 'skirt' ? 'skirt' : k === 'plain' ? 'plain' : k === 'window' ? 'window' : k,
        ),
      );
    for (const k of faceKinds.hi) add(`${pre}.hi.${k}`, faceTile(th, true, k));
  }
  // the two end variants of a skirted wall must keep skirting: faceTile() already draws wainscot for them.

  // ---------------------------------------------------------------- doorways (horizontal wall, 2 wide)
  // rows: top (cap row), mid (upper face row), bot (lower face row); l / r columns.
  const doorH = (row, side) => {
    const p = new Pix(16, 16);
    stoneSlab(p);
    // the passage gets darker the deeper it is under the lintel
    darken(p, 0, 0, 16, 16, row === 'top' ? 60 : row === 'mid' ? 28 : 0);
    if (row === 'top') darken(p, 0, 0, 16, 4, 40);
    if (side === 'l') {
      darken(p, 2, 0, 3, 16, 60);
      vline(p, 0, 0, 16, C['wood-dark']);
      vline(p, 1, 0, 16, C['wood-mid']);
    } else {
      darken(p, 12, 0, 2, 16, 22);
      vline(p, 15, 0, 16, C['wood-dark']);
      vline(p, 14, 0, 16, C['wood-lit']);
    }
    if (row === 'bot') {
      // raised sill along the floor line
      hline(p, 2, 12, 12, C['tan']);
      hline(p, 2, 13, 12, C['cream-hi']);
      hline(p, 2, 14, 12, C['cream']);
      hline(p, 2, 15, 12, C['tan']);
    }
    return p;
  };
  for (const row of ['top', 'mid', 'bot'])
    for (const side of ['l', 'r']) add(`doorway.h.${row}.${side}`, doorH(row, side));
  // Lintel (overhead layer, over the cap-row cell of the doorway): header beam + translucent shadow below.
  const lintel = (side) => {
    const p = new Pix(16, 16);
    p.rect(0, 0, 16, 7, C['wood']);
    hline(p, 0, 0, 16, C['line']);
    hline(p, 0, 1, 16, C['wood-hi']);
    hline(p, 0, 2, 16, C['wood-lit']);
    hline(p, 0, 5, 16, C['wood-dark']);
    hline(p, 0, 6, 16, C['line']);
    for (let y = 7; y < 11; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, shadowCol(y < 9 ? 90 : 40));
    if (side === 'l') {
      vline(p, 0, 0, 7, C['line']);
      p.rect(0, 7, 2, 9, shadowCol(60));
      vline(p, 0, 7, 9, C['line']);
    } else {
      vline(p, 15, 0, 7, C['line']);
      vline(p, 15, 7, 9, C['line']);
    }
    return p;
  };
  add('doorway.h.lintel.l', lintel('l'));
  add('doorway.h.lintel.r', lintel('r'));

  // Vertical wall opening, 2 tall: the same neutral stone slab, shaded under the face/cap end above it.
  const doorV = (which) => {
    const p = new Pix(16, 16);
    stoneSlab(p);
    if (which === 'top') {
      darken(p, 0, 0, 16, 3, 80);
      darken(p, 0, 3, 16, 3, 40);
    }
    vline(p, 0, 0, 16, C['tan']);
    vline(p, 15, 0, 16, C['tan']);
    return p;
  };
  add('doorway.v.top', doorV('top'));
  add('doorway.v.bot', doorV('bot'));

  // ---------------------------------------------------------------- floor shadows (translucent)
  const shadowTile = (top, left) => {
    const p = new Pix(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        let a = 0;
        if (top) a = Math.max(a, y < 3 ? 78 : y < 5 ? 40 : 0);
        if (left) a = Math.max(a, x < 3 ? 78 : x < 5 ? 40 : 0);
        if (a) p.set(x, y, shadowCol(a));
      }
    return p;
  };
  add('floor.shadow.top', shadowTile(true, false));
  add('floor.shadow.left', shadowTile(false, true));
  add('floor.shadow.corner', shadowTile(true, true));

  // ---------------------------------------------------------------- decals (transparent)
  tile('decal.chalk', (p) => {
    for (const [x, y] of [
      [3, 4],
      [5, 5],
      [9, 3],
      [11, 7],
      [6, 9],
      [2, 10],
      [12, 11],
    ])
      p.set(x, y, [248, 241, 227, 150]);
    p.rect(8, 12, 3, 1, C['trim-hi']);
    p.rect(8, 13, 3, 1, C['trim-sh']);
  });
  tile('decal.scuff', (p) => {
    hline(p, 3, 6, 5, shadowCol(46));
    hline(p, 5, 7, 4, shadowCol(30));
    hline(p, 9, 11, 3, shadowCol(40));
    p.set(2, 12, shadowCol(46));
  });
  tile('decal.book', (p) => {
    // a dropped picture book, open, seen from above
    p.rect(2, 5, 12, 8, C['line']);
    p.rect(3, 6, 5, 6, C['cream-hi']);
    p.rect(8, 6, 5, 6, C['cream']);
    vline(p, 7, 6, 6, C['tan']);
    for (const y of [7, 9]) {
      hline(p, 4, y, 3, C['tan']);
      hline(p, 9, y, 3, C['tan-dark']);
    }
    p.rect(9, 10, 3, 1, C['red']);
    hline(p, 3, 13, 11, shadowCol(50));
  });
  tile('decal.paper', (p) => {
    p.rect(4, 4, 7, 9, C['line']);
    p.rect(5, 5, 5, 7, C['cream-hi']);
    for (const y of [6, 8, 10]) hline(p, 6, y, 3, C['tan']);
    p.set(10, 12, shadowCol(50));
    hline(p, 5, 13, 7, shadowCol(40));
  });

  // ---------------------------------------------------------------- rugs
  // 3x2 play mat (48x32), rounded rectangle: blue border, cream field, four-colour alphabet squares.
  const mat = new Pix(48, 32);
  mat.rect(0, 0, 48, 32, C['line']);
  mat.rect(1, 1, 46, 30, C['blue']);
  hline(mat, 1, 1, 46, C['sky']);
  vline(mat, 1, 1, 30, C['sky']);
  hline(mat, 1, 30, 46, C['teal-dk']);
  vline(mat, 46, 1, 30, C['teal-dk']);
  for (let x = 4; x < 44; x += 4) {
    mat.set(x, 2, C['cream-hi']);
    mat.set(x + 2, 29, C['cream-hi']);
  }
  mat.rect(4, 4, 40, 24, C['line']);
  mat.rect(5, 5, 38, 22, C['cream']);
  const sq = [
    C['red'],
    C['yellow'],
    C['leaf'],
    C['orange'],
    C['yellow'],
    C['blue'],
    C['red'],
    C['leaf'],
  ];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 4; i++) {
      const x = 7 + i * 9;
      const y = 7 + j * 10;
      mat.rect(x, y, 8, 9, C['line']);
      mat.rect(x + 1, y + 1, 6, 7, sq[j * 4 + i]);
      hline(mat, x + 1, y + 1, 3, C['cream-hi']);
      mat.set(x + 3, y + 4, C['cream-hi']);
      mat.set(x + 4, y + 4, C['cream-hi']);
      mat.set(x + 3, y + 5, C['cream-hi']);
      mat.set(x + 4, y + 3, C['cream-hi']);
    }
  roundCorners(mat, 0, 0, 48, 32, 3);
  const cut = (src, names, cols, rows, prefix) => {
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const t = new Pix(16, 16);
        t.blit(src, 0, 0, i * 16, j * 16, 16, 16);
        add(`${prefix}.${names[j][i]}`, t);
      }
  };
  cut(
    mat,
    [
      ['tl', 't', 'tr'],
      ['bl', 'b', 'br'],
    ],
    3,
    2,
    'rug.play',
  );

  // Resizable 3x3 rugs: tl t tr / l c r / bl b br. Repeat t, b, l, r and c for any size >= 2x2.
  const rug9 = (prefix, profile, fieldA, fieldB, lattice, dots) => {
    const names = [
      ['tl', 't', 'tr'],
      ['l', 'c', 'r'],
      ['bl', 'b', 'br'],
    ];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const nm = names[j][i];
        const open = { n: j === 0, s: j === 2, w: i === 0, e: i === 2 };
        tile(`${prefix}.${nm}`, (p) => {
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
              const ds = [];
              if (open.n) ds.push(y);
              if (open.s) ds.push(15 - y);
              if (open.w) ds.push(x);
              if (open.e) ds.push(15 - x);
              const d = ds.length ? Math.min(...ds) : 99;
              let c;
              if (d < profile.length) c = C[profile[d]];
              else {
                c = x >> 3 === y >> 3 ? C[fieldA] : C[fieldB];
                // diamond motif: same phase on every tile so the field tiles seamlessly
                const lx = x & 7,
                  ly = y & 7;
                const dx = Math.abs(lx - 3.5),
                  dy = Math.abs(ly - 3.5);
                if (dx + dy <= 1.5) c = C[lattice];
                else if (dx + dy <= 2.5 && dx + dy > 2) c = C[dots];
              }
              p.set(x, y, c);
            }
          if (nm === 'tl') p.set(0, 0, clear);
          if (nm === 'tr') p.set(15, 0, clear);
          if (nm === 'bl') p.set(0, 15, clear);
          if (nm === 'br') p.set(15, 15, clear);
        });
      }
  };
  rug9(
    'rug.lounge',
    ['line', 'orange', 'peach-sh', 'cream-hi', 'peach-sh', 'peach'],
    'peach',
    'peach-hi',
    'orange',
    'peach-sh',
  );
  rug9(
    'rug.gallery',
    ['line', 'teal-hi', 'teal', 'cream-hi', 'teal', 'teal-sh'],
    'teal',
    'teal-hi',
    'cream-hi',
    'teal-sh',
  );
  rug9(
    'rug.reading',
    ['line', 'wine-hi', 'wine', 'glow', 'wine', 'wine-dk'],
    'moss',
    'moss-hi',
    'cream-hi',
    'moss-sh',
  );

  // hearth rug 3x1 (48x16)
  const hr = new Pix(48, 16);
  hr.rect(0, 1, 48, 14, C['line']);
  hr.rect(1, 2, 46, 12, C['wine']);
  hline(hr, 1, 2, 46, C['wine-hi']);
  hline(hr, 1, 13, 46, C['wine-dk']);
  hline(hr, 3, 4, 42, C['glow']);
  hline(hr, 3, 11, 42, C['glow']);
  for (const cx of [12, 24, 36]) {
    hr.set(cx, 6, C['cream-hi']);
    hr.set(cx - 1, 7, C['glow']);
    hr.set(cx, 7, C['cream-hi']);
    hr.set(cx + 1, 7, C['glow']);
    hr.set(cx, 8, C['cream-hi']);
    hr.set(cx - 1, 8, C['glow']);
    hr.set(cx + 1, 8, C['glow']);
    hr.set(cx, 9, C['cream-hi']);
  }
  for (let y = 3; y < 14; y += 2) {
    hr.set(0, y, C['cream']);
    hr.set(47, y, C['cream']);
  }
  roundCorners(hr, 0, 1, 48, 14, 1);
  cut(hr, [['l', 'm', 'r']], 3, 1, 'rug.hearth');

  return out;
}
