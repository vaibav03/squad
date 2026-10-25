// Furniture / decor sprite builders (procedural pixel art, 3/4 view, light from the top-left).
// Every sprite is drawn at natural size on a transparent canvas; the BASE (y-sort line) is the sprite
// bottom edge. Soft contact shadows are translucent ink pixels, everything else uses the palette.
//
// SPRITE INDEX (foot = blocking footprint in sprite px, bottom of the sprite, tile aligned in map space;
// w=h=0 means non-blocking decor / wall-hung):
//   desk.single 16x24, desk.double 32x24         school desks (paper, book on top)
//   chair.l/.r/.up/.down 16x24                   .down faces the viewer, .up shows its back (student at a desk north of it)
//   bookshelf.small 16x32, .wide 32x32, .tall 32x48
//   round.table 32x32 (cups), table.long 48x32, stool 16x16
//   plant.small 16x24, plant.big 16x32 (leaning pot)
//   chalkboard 48x32     wall-hung: sits flush on the wall, bottom edge = wall base, drawn art leaves 4px of crown above
//                        and 6px of wainscot below transparent so the wall shows around it
//   wall.clock 16x16, wall.frame 16x16, wall.frame.wide 32x16, wall.map 32x24, bulletin.board 48x32, council.banner 16x32, hearth 48x32
//                        wall-hung: place with the sprite bottom on the wall base row's bottom edge (2-row tall wall faces)
//   lamp.floor 16x32, lamp.floor.glow 48x48 (lamp centred at x 16..31 with a baked warm halo)
//   couch 48x32 (front), couch.blue, couch.back (seen from behind), bench 32x24
//   bean.bag.red/.blue/.yellow 16x16, toy.bin 16x24, globe 16x24, cabinet 32x32, water.cooler 16x32, coat.rack 16x32
//   council.table 80x32, council.chair.down/.up/.l/.r 16x32 (high backs), council.banner 16x32
//   library.reading.desk 32x24, ladder 16x32, bookcart 32x24, floor.books 16x16 (decor, non-blocking)
//   door.h.open/.closed/.locked 32x48 (2-wide, 3-deep doorway in a horizontal wall; sprite bottom = bottom of the lower face row)
//   door.v.open/.closed/.locked 16x32 (2-tall opening in a vertical wall)
import { Pix } from './png.mjs';
import {
  rng,
  hline,
  vline,
  frame,
  ellipse,
  art,
  flipH,
  contactShadow,
  box3,
  remap,
  darken,
  shadowCol,
} from './draw.mjs';

export function buildProps(C) {
  const out = [];
  const notes = {
    'wall.faces':
      'Walls are 3 rows: cap, upper face (wall.face.hi.*), lower face (wall.face.*). A wall-hung sprite (32px tall) fits the two face rows exactly.',
    chalkboard:
      'Hang on the two face rows: object x = left px, y = wall base bottom edge (bottom-left of the sprite). The sprite already includes a 4px crown gap and 6px wainscot gap. 3 tiles wide; centre it on the room.',
    'chalkboard.tile':
      'No tile version: use the chalkboard sprite. For a DOM quiz card, anchor it to the sprite rect (x, y-32, 48, 32).',
    foot: 'foot.w = foot.h = 0 means non-blocking (wall-hung or floor decor).',
  };
  const K = (n) => C[n];
  const add = (name, pix, foot, tall = false) => {
    if (foot === 'none') foot = { x: 0, y: pix.h, w: 0, h: 0 };
    else if (foot === 'full') foot = { x: 0, y: 0, w: pix.w, h: pix.h };
    out.push({ name, pix, foot, tall });
  };
  const footBottom = (pix, cellsW, cellsH = 1, x = 0) => ({
    x,
    y: pix.h - cellsH * 16,
    w: cellsW * 16,
    h: cellsH * 16,
  });
  const S = (w, h, fn) => {
    const p = new Pix(w, h);
    fn(p);
    return p;
  };
  const wood = {
    line: K('line'),
    top: K('wood-hi'),
    topHi: K('cream'),
    front: K('wood-lit'),
    frontHi: K('wood-hi'),
    frontSh: K('wood-mid'),
  };
  const darkWood = {
    line: K('line'),
    top: K('wood'),
    topHi: K('wood-lit'),
    front: K('wood-dark'),
    frontHi: K('wood'),
    frontSh: K('wood-deep'),
  };

  // ------------------------------------------------------------ desks
  const paper = (p, x, y) => {
    p.rect(x, y, 6, 4, K('line'));
    p.rect(x + 1, y + 1, 4, 2, K('cream-hi'));
    p.set(x + 1, y + 1, K('trim-sh'));
    p.set(x + 3, y + 2, K('trim-sh'));
  };
  const book = (p, x, y, col, hi) => {
    p.rect(x, y, 5, 3, K('line'));
    p.rect(x + 1, y + 1, 3, 1, col);
    p.set(x + 1, y + 1, hi);
  };
  const desk = (w) =>
    S(w, 24, (p) => {
      contactShadow(p, 1, 20, w - 2, 4, 80);
      // legs
      for (const lx of [2, w - 4]) {
        p.rect(lx, 18, 2, 4, K('line'));
        p.set(lx, 18, K('wood-mid'));
        p.set(lx, 19, K('wood-lit'));
        p.set(lx, 20, K('wood-mid'));
      }
      box3(p, 1, 4, w - 2, 7, 13, wood);
      // drawers
      const drawers = w > 16 ? [3, w - 11] : [3];
      for (const dx of drawers) {
        p.rect(dx, 13, 8, 5, K('line'));
        p.rect(dx + 1, 14, 6, 3, K('wood-mid'));
        hline(p, dx + 1, 14, 6, K('wood'));
        p.set(dx + 3, 15, K('glow'));
        p.set(dx + 4, 15, K('glow-hi'));
      }
      paper(p, 3, 6);
      if (w > 16) {
        paper(p, w - 11, 6);
        book(p, w / 2 - 2, 6, K('blue'), K('sky'));
      } else {
        p.rect(10, 6, 1, 3, K('line'));
        p.set(10, 6, K('red'));
      }
    });
  add('desk.single', desk(16), footBottom(desk(16), 1));
  add('desk.double', desk(32), footBottom(desk(32), 2));

  // ------------------------------------------------------------ chairs
  const chairDown = (tall = false) =>
    S(16, tall ? 32 : 24, (p) => {
      const o = tall ? 8 : 0;
      contactShadow(p, 3, 20 + o, 11, 3, 80);
      // front legs
      for (const lx of [4, 10]) {
        p.rect(lx, 17 + o, 2, 5, K('line'));
        p.set(lx, 18 + o, K('wood-lit'));
        p.set(lx, 19 + o, K('wood-mid'));
      }
      // backrest (behind the seat)
      if (!tall) {
        p.rect(4, 3, 8, 10, K('line'));
        p.rect(5, 4, 6, 8, K('wood-lit'));
        hline(p, 5, 4, 6, K('wood-hi'));
        hline(p, 5, 7, 6, K('wood-mid'));
        hline(p, 5, 9, 6, K('wood-mid'));
      }
      // seat
      p.rect(3, 12 + o, 10, 7, K('line'));
      p.rect(4, 13 + o, 8, 4, K('wood-hi'));
      hline(p, 4, 13 + o, 8, K('cream'));
      hline(p, 4, 17 + o, 8, K('wood-lit'));
      hline(p, 4, 18 + o, 8, K('wood-mid'));
    });
  const chairUp = () =>
    S(16, 24, (p) => {
      contactShadow(p, 3, 20, 11, 3, 80);
      for (const lx of [4, 10]) {
        p.rect(lx, 17, 2, 5, K('line'));
        p.set(lx, 18, K('wood-lit'));
        p.set(lx, 19, K('wood-mid'));
      }
      // seat peeking above the backrest
      p.rect(3, 6, 10, 6, K('line'));
      p.rect(4, 7, 8, 4, K('wood-hi'));
      hline(p, 4, 7, 8, K('cream'));
      // backrest front
      p.rect(3, 10, 10, 9, K('line'));
      p.rect(4, 11, 8, 7, K('wood-lit'));
      hline(p, 4, 11, 8, K('wood-hi'));
      hline(p, 4, 14, 8, K('wood-mid'));
      hline(p, 4, 16, 8, K('wood-mid'));
      hline(p, 4, 17, 8, K('wood'));
    });
  const chairL = () =>
    S(16, 24, (p) => {
      contactShadow(p, 3, 20, 11, 3, 80);
      // back legs / front legs
      for (const lx of [3, 11]) {
        p.rect(lx, 17, 2, 5, K('line'));
        p.set(lx, 18, K('wood-lit'));
        p.set(lx, 19, K('wood-mid'));
      }
      // backrest on the east side
      p.rect(10, 3, 4, 17, K('line'));
      p.rect(11, 4, 2, 15, K('wood-lit'));
      vline(p, 11, 4, 13, K('wood-hi'));
      vline(p, 12, 4, 15, K('wood-mid'));
      // seat
      p.rect(2, 12, 10, 7, K('line'));
      p.rect(3, 13, 8, 4, K('wood-hi'));
      hline(p, 3, 13, 8, K('cream'));
      hline(p, 3, 17, 8, K('wood-lit'));
      hline(p, 3, 18, 8, K('wood-mid'));
    });
  add('chair.down', chairDown(), footBottom(chairDown(), 1));
  add('chair.up', chairUp(), footBottom(chairUp(), 1));
  add('chair.l', chairL(), footBottom(chairL(), 1));
  add('chair.r', flipH(chairL()), footBottom(chairL(), 1));

  // ------------------------------------------------------------ bookshelves
  const bookCols = [
    'red',
    'yellow',
    'blue',
    'leaf',
    'orange',
    'trim-hi',
    'plum',
    'teal',
    'wine-hi',
    'moss-hi',
  ];
  const shelfBooks = (p, x0, x1, yBottom, maxH, r) => {
    let x = x0;
    while (x < x1 - 1) {
      const w = r() < 0.35 ? 3 : 2;
      if (x + w > x1) break;
      if (r() < 0.12) {
        x += 2; // gap
        continue;
      }
      const h = Math.max(4, maxH - Math.floor(r() * 4));
      const col = K(bookCols[Math.floor(r() * bookCols.length)]);
      p.rect(x, yBottom - h, w, h, col);
      vline(p, x + w - 1, yBottom - h, h, K('line-soft'));
      hline(p, x, yBottom - h, w - 1, K('cream-hi'));
      if (r() < 0.5) hline(p, x, yBottom - 3, w - 1, K('cream-hi'));
      x += w;
    }
  };
  const shelf = (w, h, seed, th = darkWood) =>
    S(w, h, (p) => {
      const r = rng(seed);
      const baseY = h - 4;
      contactShadow(p, 1, h - 4, w - 2, 4, 80);
      p.rect(0, 0, w, baseY + 1, K('line'));
      // top surface
      p.rect(1, 1, w - 2, 3, K('wood-hi'));
      hline(p, 1, 1, w - 2, K('cream'));
      hline(p, 1, 4, w - 2, K('wood-lit'));
      // carcass sides
      p.rect(1, 5, w - 2, baseY - 5, K('wood'));
      vline(p, 1, 5, baseY - 5, K('wood-lit'));
      vline(p, w - 2, 5, baseY - 5, K('wood-dark'));
      // compartments
      const innerTop = 5;
      const innerBottom = baseY - 3;
      const n = Math.max(2, Math.round((innerBottom - innerTop) / 10.5));
      const ch = Math.floor((innerBottom - innerTop - (n - 1) * 2) / n);
      for (let k = 0; k < n; k++) {
        const y0 = innerTop + k * (ch + 2);
        p.rect(3, y0, w - 6, ch, K('wood-deep'));
        hline(p, 3, y0, w - 6, K('line'));
        shelfBooks(p, 3, w - 3, y0 + ch, ch - 1, r);
        // plank under compartment
        hline(p, 2, y0 + ch, w - 4, K('wood-hi'));
        hline(p, 2, y0 + ch + 1, w - 4, K('wood-mid'));
      }
      // plinth
      p.rect(1, baseY - 2, w - 2, 3, K('wood-dark'));
      hline(p, 1, baseY - 2, w - 2, K('wood'));
      hline(p, 0, baseY, w, K('line'));
    });
  const bsSmall = shelf(16, 32, 3);
  add('bookshelf.small', bsSmall, footBottom(bsSmall, 1), true);
  const bsWide = shelf(32, 32, 7);
  add('bookshelf.wide', bsWide, footBottom(bsWide, 2), true);
  const bsTall = shelf(32, 48, 13);
  add('bookshelf.tall', bsTall, footBottom(bsTall, 2), true);

  // ------------------------------------------------------------ tables
  const cup = (p, x, y, tea = true) => {
    // mug seen from above-front: rim ellipse with tea, small handle
    p.rect(x, y + 1, 3, 2, K('line'));
    p.rect(x, y, 3, 1, K('line'));
    p.set(x + 1, y, tea ? K('orange') : K('cream-hi'));
    p.set(x, y + 1, K('cream-hi'));
    p.set(x + 1, y + 1, K('cream'));
    p.set(x + 3, y + 1, K('line'));
  };
  const teapot = (p, x, y) => {
    p.rect(x, y + 1, 6, 4, K('line'));
    p.rect(x + 1, y + 1, 4, 3, K('teal'));
    hline(p, x + 1, y + 1, 4, K('teal-hi'));
    p.rect(x + 2, y, 2, 1, K('line'));
    p.set(x + 6, y + 2, K('line'));
    p.set(x - 1, y + 2, K('line'));
  };
  const roundTable = S(32, 32, (p) => {
    contactShadow(p, 3, 27, 26, 5, 80);
    // pedestal
    p.rect(13, 21, 6, 7, K('line'));
    p.rect(14, 21, 3, 6, K('wood-lit'));
    p.rect(17, 21, 1, 6, K('wood-mid'));
    p.rect(9, 26, 14, 3, K('line'));
    p.rect(10, 26, 12, 2, K('wood-lit'));
    hline(p, 10, 27, 12, K('wood-mid'));
    // table top edge + surface
    ellipse(p, 16, 14, 15.5, 9.5, K('line'));
    ellipse(p, 16, 14, 14.5, 8.5, K('wood-mid'));
    ellipse(p, 16, 12.6, 14.5, 8.5, K('wood-lit'));
    ellipse(p, 16, 12.4, 13.5, 7.6, K('wood-hi'));
    // lit rim on the upper-left
    for (const [x, y] of [
      [6, 7],
      [7, 6],
      [8, 5],
      [9, 5],
      [11, 4],
      [12, 4],
    ])
      p.set(x, y, K('cream'));
    // tablecloth runner + teapot + two mugs (asymmetric so it does not read as a face)
    cup(p, 8, 12);
    cup(p, 21, 10, false);
    teapot(p, 13, 9);
    p.rect(19, 14, 5, 2, K('line'));
    p.rect(20, 14, 3, 1, K('trim-hi'));
  });
  add('round.table', roundTable, 'full');

  const longTable = S(48, 32, (p) => {
    contactShadow(p, 2, 27, 44, 5, 80);
    for (const lx of [3, 22, 42]) {
      p.rect(lx, 21, 3, 8, K('line'));
      vline(p, lx + 1, 22, 6, K('wood-lit'));
      vline(p, lx + 2, 22, 6, K('wood-mid'));
    }
    // top slab (lit), thin front edge, apron
    p.rect(1, 3, 46, 20, K('line'));
    p.rect(2, 4, 44, 14, K('wood-hi'));
    hline(p, 2, 4, 44, K('cream'));
    vline(p, 2, 4, 14, K('cream'));
    p.rect(2, 18, 44, 2, K('wood-lit'));
    p.rect(2, 20, 44, 2, K('wood-mid'));
    hline(p, 2, 21, 44, K('wood'));
    // runner + things
    p.rect(5, 8, 38, 5, K('teal'));
    hline(p, 5, 8, 38, K('teal-hi'));
    hline(p, 5, 12, 38, K('teal-sh'));
    cup(p, 9, 6);
    cup(p, 30, 9, false);
    teapot(p, 19, 6);
    p.rect(36, 5, 5, 3, K('line'));
    p.rect(37, 5, 3, 2, K('red'));
  });
  add('table.long', longTable, 'full');

  const stool = S(16, 16, (p) => {
    contactShadow(p, 3, 12, 10, 4, 80);
    for (const lx of [4, 10]) {
      p.rect(lx, 10, 2, 4, K('line'));
      p.set(lx, 11, K('wood-lit'));
    }
    ellipse(p, 8, 8.5, 6.5, 4.5, K('line'));
    ellipse(p, 8, 8.5, 5.5, 3.5, K('wood-mid'));
    ellipse(p, 8, 7.6, 5.5, 3.5, K('wood-hi'));
    p.set(5, 6, K('cream'));
    p.set(6, 5, K('cream'));
  });
  add('stool', stool, footBottom(stool, 1));

  // ------------------------------------------------------------ plants
  const blob = (p, cx, cy, rx, ry) => {
    ellipse(p, cx, cy, rx, ry, K('leaf-line'));
    ellipse(p, cx, cy, rx - 1, ry - 1, K('leaf-dk'));
    ellipse(p, cx - 0.6, cy - 0.7, rx - 1.6, ry - 1.7, K('leaf'));
    ellipse(p, cx - 1.4, cy - 1.5, Math.max(1, rx - 3), Math.max(1, ry - 3), K('leaf-hi'));
  };
  const pot = (p, cx, y, w, h, lean = 0, cols = ['orange', 'wood-lit', 'wood-mid']) => {
    // flowerpot: rim + body tapering to the base; lean shifts rows horizontally
    for (let j = 0; j < h; j++) {
      const t = j / (h - 1);
      const half = Math.round((w / 2) * (1 - 0.22 * Math.max(0, (j - 2) / h)));
      const sx = Math.round(lean * (1 - t));
      p.rect(cx - half + sx, y + j, half * 2, 1, K('line'));
      if (j > 0 && j < h - 1) {
        p.rect(cx - half + 1 + sx, y + j, half * 2 - 2, 1, j < 3 ? K(cols[1]) : K(cols[0]));
        p.set(cx - half + 1 + sx, y + j, K(cols[1]));
        p.set(cx + half - 2 + sx, y + j, K(cols[2]));
      }
    }
  };
  const plantSmall = S(16, 24, (p) => {
    contactShadow(p, 3, 20, 10, 4, 80);
    pot(p, 8, 14, 10, 8);
    hline(p, 4, 14, 8, K('orange'));
    hline(p, 4, 15, 8, K('wood-mid'));
    blob(p, 8, 6, 4.5, 4);
    blob(p, 4.5, 9, 3.5, 3.2);
    blob(p, 11.5, 9, 3.5, 3.2);
    p.rect(7, 11, 2, 4, K('leaf-dk'));
    p.rect(5, 13, 6, 2, K('wood-deep'));
  });
  add('plant.small', plantSmall, footBottom(plantSmall, 1));
  const plantBig = S(16, 32, (p) => {
    contactShadow(p, 2, 28, 12, 4, 80);
    pot(p, 8, 19, 12, 10, 1, ['plum', 'plum-hi', 'plum-sh']);
    hline(p, 3, 19, 11, K('plum-hi'));
    // stems
    vline(p, 8, 10, 10, K('leaf-line'));
    p.set(7, 14, K('leaf-line'));
    p.set(9, 12, K('leaf-line'));
    blob(p, 8, 5, 5, 4.5);
    blob(p, 4, 10, 3.8, 3.4);
    blob(p, 12.5, 11, 3.8, 3.4);
    blob(p, 6, 14.5, 3.4, 2.8);
    blob(p, 11, 16, 3.2, 2.6);
    p.rect(5, 17, 7, 2, K('wood-deep'));
  });
  add('plant.big', plantBig, footBottom(plantBig, 1), true);

  // ------------------------------------------------------------ wall-hung: chalkboard, clock, frames, map, bulletin, banner, hearth
  const chalkboard = S(48, 32, (p) => {
    // art lives in y 4..27, tray 26..29, soft wall shadow under it
    p.rect(2, 5, 46, 23, shadowCol(46)); // wall shadow right/below
    p.rect(0, 4, 46, 23, K('line'));
    p.rect(1, 5, 44, 21, K('wood-lit'));
    hline(p, 1, 5, 44, K('wood-hi'));
    vline(p, 1, 5, 21, K('wood-hi'));
    hline(p, 1, 25, 44, K('wood-mid'));
    vline(p, 44, 5, 21, K('wood-mid'));
    p.rect(3, 7, 40, 17, K('line'));
    p.rect(4, 8, 38, 15, K('board'));
    // chalk sheen strokes
    for (const [x, y, l] of [
      [6, 9, 5],
      [14, 11, 4],
      [30, 9, 6],
      [22, 20, 5],
      [36, 16, 3],
    ])
      hline(p, x, y, l, K('board-lit'));
    // writing
    hline(p, 7, 11, 14, K('trim-hi'));
    hline(p, 7, 14, 10, K('trim-hi'));
    hline(p, 7, 17, 12, K('trim-sh'));
    for (const x of [9, 12, 15]) p.set(x, 12, K('trim-hi'));
    // little diagram: triangle
    vline(p, 28, 12, 8, K('trim-hi'));
    hline(p, 28, 19, 9, K('trim-hi'));
    for (let i = 0; i < 8; i++) p.set(29 + i, 18 - i, K('trim-hi'));
    p.set(33, 15, K('yellow'));
    // chalk tray
    p.rect(2, 26, 42, 3, K('line'));
    hline(p, 3, 26, 40, K('wood-hi'));
    hline(p, 3, 27, 40, K('wood-lit'));
    p.rect(8, 25, 4, 1, K('cream-hi'));
    p.rect(30, 24, 6, 2, K('line'));
    p.rect(31, 24, 4, 1, K('teal'));
  });
  add('chalkboard', chalkboard, 'none');

  const clock = S(16, 16, (p) => {
    p.rect(3, 4, 11, 11, shadowCol(40));
    ellipse(p, 7.5, 7.5, 6.5, 6.5, K('line'));
    ellipse(p, 7.5, 7.5, 5.5, 5.5, K('wood-lit'));
    ellipse(p, 7.5, 7.5, 4.5, 4.5, K('cream-hi'));
    for (const [x, y] of [
      [7, 4],
      [7, 11],
      [4, 7],
      [11, 7],
    ])
      p.set(x, y, K('wood-mid'));
    vline(p, 7, 5, 3, K('line'));
    hline(p, 7, 7, 3, K('line'));
    p.set(7, 7, K('red'));
    p.set(4, 3, K('wood-hi'));
  });
  add('wall.clock', clock, 'none');

  const picture = (w, h, kind) =>
    S(w, h, (p) => {
      p.rect(1, 2, w - 1, h - 2, shadowCol(40));
      p.rect(0, 1, w - 1, h - 3, K('line'));
      p.rect(1, 2, w - 3, h - 5, K('wood-lit'));
      hline(p, 1, 2, w - 3, K('wood-hi'));
      p.rect(3, 4, w - 7, h - 9, K('line'));
      p.rect(4, 5, w - 9, h - 11, K('sky'));
      const iw = w - 9,
        ih = h - 11;
      // sun + hills
      p.rect(4 + iw - 4, 6, 2, 2, K('glow'));
      for (let x = 0; x < iw; x++) {
        const hh = Math.round(ih * 0.45 + Math.sin(x / (kind === 'wide' ? 3 : 2.2)) * 1.5);
        for (let y = ih - hh; y < ih; y++)
          p.set(4 + x, 5 + y, y === ih - hh ? K('leaf-hi') : y > ih - 2 ? K('leaf-dk') : K('leaf'));
      }
    });
  add('wall.frame', picture(16, 16, 'sq'), 'none');
  add('wall.frame.wide', picture(32, 16, 'wide'), 'none');

  const worldMap = S(32, 24, (p) => {
    p.rect(2, 3, 30, 21, shadowCol(40));
    p.rect(0, 2, 30, 19, K('line'));
    p.rect(1, 3, 28, 17, K('cream'));
    hline(p, 1, 3, 28, K('cream-hi'));
    p.rect(2, 5, 26, 14, K('sky'));
    // continents
    p.rect(5, 8, 6, 5, K('leaf'));
    p.rect(7, 13, 3, 4, K('leaf'));
    p.rect(15, 7, 5, 4, K('leaf'));
    p.rect(17, 11, 4, 5, K('leaf-dk'));
    p.rect(22, 9, 4, 3, K('leaf'));
    for (const [x, y] of [
      [5, 8],
      [15, 7],
      [22, 9],
    ])
      p.set(x, y, K('leaf-hi'));
    p.set(12, 15, K('red'));
    // roller rods
    p.rect(0, 1, 30, 2, K('line'));
    hline(p, 1, 1, 28, K('wood-hi'));
    p.rect(0, 20, 30, 2, K('line'));
    hline(p, 1, 20, 28, K('wood-lit'));
  });
  add('wall.map', worldMap, 'none');

  const bulletin = S(48, 32, (p) => {
    p.rect(2, 5, 46, 24, shadowCol(46));
    p.rect(0, 4, 46, 24, K('line'));
    p.rect(1, 5, 44, 22, K('wood-mid'));
    hline(p, 1, 5, 44, K('wood-hi'));
    vline(p, 1, 5, 22, K('wood-hi'));
    p.rect(3, 7, 40, 18, K('line'));
    p.rect(4, 8, 38, 16, K('wood-lit'));
    // cork speckle
    const r = rng(41);
    for (let i = 0; i < 26; i++)
      p.set(
        4 + Math.floor(r() * 38),
        8 + Math.floor(r() * 16),
        r() < 0.5 ? K('wood-hi') : K('wood-mid'),
      );
    // pinned cards 3 columns x 2 rows
    const cols = ['cream-hi', 'sky-hi', 'peach-hi', 'moss-hi', 'cream', 'teal-hi'];
    const pins = ['red', 'blue', 'yellow', 'orange', 'red', 'plum'];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 3; i++) {
        const x = 6 + i * 12 + (j ? 1 : 0);
        const y = 9 + j * 8 + (i === 1 ? 1 : 0);
        p.rect(x, y, 10, 7, K('line'));
        p.rect(x + 1, y + 1, 8, 5, K(cols[j * 3 + i]));
        hline(p, x + 2, y + 3, 5, K('trim-sh'));
        hline(p, x + 2, y + 4, 3, K('trim-sh'));
        p.set(x + 4, y, K(pins[j * 3 + i]));
      }
    p.rect(14, 25, 18, 2, K('line'));
  });
  add('bulletin.board', bulletin, 'none');

  const banner = S(16, 32, (p) => {
    p.rect(1, 0, 14, 3, K('line'));
    p.rect(2, 0, 12, 2, K('wood-lit'));
    hline(p, 2, 0, 12, K('wood-hi'));
    p.rect(0, 0, 2, 3, K('line'));
    p.rect(14, 0, 2, 3, K('line'));
    p.set(0, 1, K('glow'));
    p.set(15, 1, K('glow'));
    // cloth with swallow tail
    for (let y = 3; y < 30; y++) {
      const tail = y > 25 ? y - 25 : 0;
      const x0 = 2,
        x1 = 14;
      for (let x = x0; x < x1; x++) {
        const mid = Math.abs(x - 7.5);
        if (tail && mid < tail * 1.4) continue;
        p.set(x, y, K('wine'));
      }
    }
    // outline
    for (let y = 3; y < 30; y++) {
      p.set(1, y, K('line'));
      p.set(14, y, K('line'));
    }
    for (let x = 2; x < 14; x++) {
      const mid = Math.abs(x - 7.5);
      if (mid > 1.4 * 5) hline(p, x, 29, 1, K('line'));
    }
    p.set(7, 28, K('line'));
    p.set(8, 28, K('line'));
    p.set(6, 27, K('line'));
    p.set(9, 27, K('line'));
    p.set(5, 26, K('line'));
    p.set(10, 26, K('line'));
    vline(p, 2, 3, 26, K('wine-hi'));
    vline(p, 12, 3, 24, K('wine-dk'));
    // gold trim and crest
    hline(p, 3, 5, 10, K('glow'));
    vline(p, 3, 5, 18, K('glow'));
    vline(p, 12, 5, 18, K('glow'));
    ellipse(p, 8, 13, 3.5, 3.5, K('glow'));
    ellipse(p, 8, 13, 2.5, 2.5, K('wine'));
    p.set(8, 12, K('glow-hi'));
    p.set(7, 13, K('glow-hi'));
    p.set(9, 13, K('glow-hi'));
    p.set(8, 14, K('glow-hi'));
    p.set(8, 13, K('glow'));
    hline(p, 6, 20, 5, K('glow'));
  });
  add('council.banner', banner, 'none');

  const hearth = S(48, 32, (p) => {
    p.rect(2, 5, 46, 27, shadowCol(40));
    // chimney breast
    p.rect(2, 0, 42, 6, K('line'));
    p.rect(3, 0, 40, 5, K('trim-sh'));
    hline(p, 3, 0, 40, K('trim'));
    // mantel
    p.rect(0, 5, 46, 4, K('line'));
    p.rect(1, 5, 44, 3, K('wood-hi'));
    hline(p, 1, 5, 44, K('cream'));
    hline(p, 1, 7, 44, K('wood-mid'));
    // surround
    p.rect(3, 9, 40, 23, K('line'));
    p.rect(4, 9, 38, 22, K('trim'));
    vline(p, 4, 9, 22, K('trim-hi'));
    vline(p, 41, 9, 22, K('trim-sh'));
    for (let y = 11; y < 31; y += 4) {
      hline(p, 4, y, 6, K('trim-sh'));
      hline(p, 36, y + 2, 6, K('trim-sh'));
    }
    // firebox
    p.rect(11, 12, 24, 20, K('line'));
    p.rect(12, 13, 22, 19, K('wood-deep'));
    // flames
    ellipse(p, 23, 28, 8, 6, K('red'));
    ellipse(p, 23, 28, 6.5, 5.5, K('orange'));
    ellipse(p, 20, 26, 3, 5, K('orange'));
    ellipse(p, 26, 25, 3, 6, K('orange'));
    ellipse(p, 23, 27, 4, 4.5, K('glow'));
    ellipse(p, 23, 28, 2, 3, K('glow-hi'));
    p.set(23, 21, K('glow'));
    p.set(23, 22, K('glow'));
    p.set(26, 20, K('orange'));
    // logs
    p.rect(13, 29, 20, 3, K('line'));
    hline(p, 14, 29, 18, K('wood'));
    hline(p, 14, 30, 18, K('wood-dark'));
    p.rect(17, 28, 3, 1, K('wood-lit'));
    // mantel items
    p.rect(6, 1, 5, 4, K('line'));
    p.rect(7, 2, 3, 2, K('glow'));
    p.rect(34, 2, 6, 3, K('line'));
    p.rect(35, 2, 4, 2, K('leaf'));
  });
  add('hearth', hearth, 'none');

  // ------------------------------------------------------------ lamps
  const lamp = (halo) => {
    const W = halo ? 48 : 16;
    const H = halo ? 48 : 32;
    const ox = halo ? 16 : 0;
    const oy = halo ? 16 : 0;
    return S(W, H, (p) => {
      if (halo) {
        const gl = (a) => [255, 214, 116, a];
        const rows = [
          [22, 20, 26],
          [17, 15, 38],
          [12, 10, 52],
        ];
        for (const [rx, ry, a] of rows) ellipse(p, 24, 22, rx, ry, gl(a));
      }
      contactShadow(p, ox + 3, oy + 28, 10, 4, 80);
      // base + pole
      p.rect(ox + 4, oy + 26, 8, 3, K('line'));
      p.rect(ox + 5, oy + 26, 6, 2, K('wood-lit'));
      hline(p, ox + 5, oy + 27, 6, K('wood-mid'));
      p.rect(ox + 7, oy + 11, 2, 15, K('line'));
      vline(p, ox + 7, oy + 12, 14, K('wood-hi'));
      vline(p, ox + 8, oy + 12, 14, K('wood-mid'));
      // shade
      p.rect(ox + 2, oy + 3, 12, 9, K('line'));
      p.rect(ox + 3, oy + 4, 10, 7, K('glow'));
      hline(p, ox + 3, oy + 4, 10, K('glow-hi'));
      p.rect(ox + 4, oy + 5, 6, 4, K('glow-hi'));
      hline(p, ox + 3, oy + 10, 10, K('orange'));
      vline(p, ox + 12, oy + 5, 5, K('orange'));
      p.set(ox + 2, oy + 3, [0, 0, 0, 0]);
      p.set(ox + 13, oy + 3, [0, 0, 0, 0]);
    });
  };
  add('lamp.floor', lamp(false), footBottom(lamp(false), 1), true);
  const lg = lamp(true);
  add('lamp.floor.glow', lg, { x: 16, y: 32, w: 16, h: 16 }, true);

  // ------------------------------------------------------------ couches
  const couchFront = S(48, 32, (p) => {
    contactShadow(p, 1, 28, 46, 4, 80);
    // legs
    for (const lx of [4, 41]) p.rect(lx, 27, 3, 2, K('line'));
    // backrest
    p.rect(5, 3, 38, 15, K('line'));
    p.rect(6, 4, 36, 13, K('wine'));
    hline(p, 6, 4, 36, K('wine-hi'));
    hline(p, 6, 5, 36, K('wine-hi'));
    for (const x of [18, 30]) {
      vline(p, x, 6, 11, K('wine-dk'));
      vline(p, x - 1, 6, 10, K('wine-hi'));
    }
    hline(p, 6, 16, 36, K('wine-dk'));
    // seat cushions
    p.rect(4, 15, 40, 12, K('line'));
    p.rect(5, 16, 38, 10, K('wine'));
    hline(p, 5, 16, 38, K('wine-hi'));
    for (const x of [17, 30]) vline(p, x, 17, 9, K('wine-dk'));
    hline(p, 5, 25, 38, K('wine-dk'));
    for (const x of [5, 18, 31]) {
      vline(p, x, 17, 8, K('wine-hi'));
    }
    // arms
    for (const [x0, flip] of [
      [0, false],
      [40, true],
    ]) {
      p.rect(x0, 9, 8, 19, K('line'));
      p.rect(x0 + 1, 10, 6, 17, K('wine'));
      hline(p, x0 + 1, 10, 6, K('wine-hi'));
      hline(p, x0 + 1, 11, 6, K('wine-hi'));
      vline(p, flip ? x0 + 6 : x0 + 1, 11, 15, flip ? K('wine-dk') : K('wine-hi'));
      hline(p, x0 + 1, 26, 6, K('wine-dk'));
    }
    // a little cushion
    p.rect(8, 11, 7, 6, K('line'));
    p.rect(9, 12, 5, 4, K('yellow'));
    p.set(9, 12, K('glow-hi'));
  });
  add('couch', couchFront, footBottom(couchFront, 3), true);
  const blue = [
    ['wine', 'blue'],
    ['wine-hi', 'sky'],
    ['wine-dk', 'teal-dk'],
    ['yellow', 'peach'],
  ];
  const couchBlue = remap(couchFront, blue);
  add('couch.blue', couchBlue, footBottom(couchBlue, 3), true);
  const couchBack = S(48, 32, (p) => {
    contactShadow(p, 1, 28, 46, 4, 80);
    for (const lx of [4, 41]) p.rect(lx, 27, 3, 2, K('line'));
    // seat edge peeking above the back
    p.rect(6, 6, 36, 5, K('line'));
    p.rect(7, 7, 34, 3, K('blue'));
    hline(p, 7, 7, 34, K('sky'));
    // backrest, big face toward the viewer
    p.rect(3, 9, 42, 19, K('line'));
    p.rect(4, 10, 40, 17, K('blue'));
    hline(p, 4, 10, 40, K('sky'));
    hline(p, 4, 11, 40, K('sky'));
    for (const x of [17, 30]) {
      vline(p, x, 13, 13, K('teal-dk'));
      vline(p, x - 1, 13, 12, K('sky'));
    }
    hline(p, 4, 26, 40, K('teal-dk'));
    hline(p, 4, 25, 40, K('teal-dk'));
    for (const [x0, fl] of [
      [0, false],
      [40, true],
    ]) {
      p.rect(x0, 4, 8, 24, K('line'));
      p.rect(x0 + 1, 5, 6, 22, K('blue'));
      hline(p, x0 + 1, 5, 6, K('sky'));
      hline(p, x0 + 1, 6, 6, K('sky'));
      vline(p, fl ? x0 + 6 : x0 + 1, 7, 18, fl ? K('teal-dk') : K('sky'));
    }
  });
  add('couch.back', couchBack, footBottom(couchBack, 3), true);

  const bench = S(32, 24, (p) => {
    contactShadow(p, 1, 20, 30, 4, 80);
    for (const lx of [3, 26]) {
      p.rect(lx, 16, 3, 5, K('line'));
      vline(p, lx + 1, 17, 3, K('wood-lit'));
    }
    // low slatted back
    p.rect(1, 3, 30, 7, K('line'));
    p.rect(2, 4, 28, 5, K('wood-lit'));
    hline(p, 2, 4, 28, K('wood-hi'));
    hline(p, 2, 6, 28, K('wood-mid'));
    // seat with teal cushion
    p.rect(0, 9, 32, 9, K('line'));
    p.rect(1, 10, 30, 6, K('teal'));
    hline(p, 1, 10, 30, K('teal-hi'));
    vline(p, 1, 10, 6, K('teal-hi'));
    hline(p, 1, 15, 30, K('teal-sh'));
    p.rect(1, 16, 30, 1, K('wood-mid'));
    vline(p, 16, 11, 4, K('teal-sh'));
  });
  add('bench', bench, footBottom(bench, 2));

  // ------------------------------------------------------------ small furniture
  const beanBag = (light, mid, dark) =>
    S(16, 16, (p) => {
      contactShadow(p, 1, 12, 14, 4, 80);
      ellipse(p, 8, 8.5, 7.3, 6.2, K('line'));
      ellipse(p, 8, 8.7, 6.4, 5.4, K(dark));
      ellipse(p, 7.6, 7.9, 6, 5, K(mid));
      ellipse(p, 6.3, 6, 3.6, 2.6, K(light));
      p.set(5, 5, K('cream-hi'));
      p.set(6, 5, K('cream-hi'));
      // seam and cinch
      vline(p, 8, 4, 2, K(dark));
      hline(p, 4, 10, 4, K(dark));
    });
  for (const [n, l, m, d] of [
    ['red', 'orange', 'red', 'wine'],
    ['blue', 'sky', 'blue', 'teal-dk'],
    ['yellow', 'glow-hi', 'yellow', 'orange'],
  ]) {
    const b = beanBag(l, m, d);
    add(`bean.bag.${n}`, b, footBottom(b, 1));
  }

  const toyBin = S(16, 24, (p) => {
    contactShadow(p, 1, 20, 14, 4, 80);
    // toys sticking out
    ellipse(p, 5, 8, 3.4, 3.4, K('line'));
    ellipse(p, 5, 8, 2.4, 2.4, K('red'));
    p.set(4, 7, K('peach-hi'));
    p.rect(9, 5, 5, 6, K('line'));
    p.rect(10, 6, 3, 4, K('blue'));
    p.set(10, 6, K('sky'));
    p.rect(7, 3, 3, 3, K('line'));
    p.set(8, 4, K('yellow'));
    box3(p, 1, 9, 14, 3, 11, { ...wood, top: K('wood-mid'), topHi: K('wood-lit') });
    p.rect(4, 14, 8, 4, K('line'));
    p.rect(5, 15, 6, 2, K('cream'));
    p.set(6, 15, K('red'));
    p.set(8, 15, K('blue'));
    p.set(10, 15, K('leaf'));
  });
  add('toy.bin', toyBin, footBottom(toyBin, 1));

  const globe = S(16, 24, (p) => {
    contactShadow(p, 2, 20, 12, 4, 80);
    p.rect(6, 15, 4, 5, K('line'));
    vline(p, 7, 15, 4, K('wood-lit'));
    p.rect(3, 19, 10, 2, K('line'));
    hline(p, 4, 19, 8, K('wood-hi'));
    hline(p, 4, 20, 8, K('wood-mid'));
    ellipse(p, 8, 9, 7, 7, K('line'));
    ellipse(p, 8, 9, 6, 6, K('blue'));
    ellipse(p, 7.4, 8.4, 5, 5, K('blue'));
    ellipse(p, 6, 6, 2.6, 2, K('sky'));
    p.rect(5, 8, 4, 3, K('leaf'));
    p.rect(9, 5, 3, 3, K('leaf'));
    p.rect(8, 12, 3, 2, K('leaf-dk'));
    p.set(5, 8, K('leaf-hi'));
    p.set(5, 4, K('sky-hi'));
    // meridian ring
    for (let y = 3; y < 15; y++) p.set(14 - Math.round(Math.abs(y - 9) * 0.3), y, K('wood-lit'));
  });
  add('globe', globe, footBottom(globe, 1));

  const cabinet = S(32, 32, (p) => {
    contactShadow(p, 1, 28, 30, 4, 80);
    // things on top
    p.rect(21, 1, 8, 6, K('line'));
    p.rect(22, 2, 6, 4, K('blue'));
    p.set(22, 2, K('sky'));
    p.rect(22, 3, 6, 1, K('cream'));
    ellipse(p, 8, 4.5, 4, 3, K('line'));
    ellipse(p, 8, 4.5, 3, 2, K('orange'));
    p.set(7, 4, K('glow'));
    box3(p, 1, 6, 30, 6, 21, wood);
    // doors
    for (const dx of [3, 17]) {
      p.rect(dx, 14, 12, 12, K('line'));
      p.rect(dx + 1, 15, 10, 10, K('wood-mid'));
      hline(p, dx + 1, 15, 10, K('wood'));
      vline(p, dx + 1, 15, 10, K('wood'));
      p.rect(dx + 3, 17, 6, 6, K('wood-lit'));
      hline(p, dx + 3, 17, 6, K('wood-hi'));
    }
    p.set(14, 19, K('glow'));
    p.set(17, 19, K('glow'));
  });
  add('cabinet', cabinet, footBottom(cabinet, 2), true);

  const cooler = S(16, 32, (p) => {
    contactShadow(p, 2, 28, 12, 4, 80);
    // jug
    p.rect(4, 1, 8, 10, K('line'));
    p.rect(5, 2, 6, 8, K('sky'));
    p.rect(5, 5, 6, 5, K('blue'));
    vline(p, 5, 2, 7, K('sky-hi'));
    hline(p, 5, 5, 6, K('sky-hi'));
    p.rect(6, 0, 4, 2, K('line'));
    // body
    box3(p, 2, 10, 12, 3, 18, {
      line: K('line'),
      top: K('trim-hi'),
      topHi: K('trim-hi'),
      front: K('trim'),
      frontHi: K('trim-hi'),
      frontSh: K('trim-sh'),
    });
    // two taps on the shoulder, drip tray low
    p.rect(4, 15, 3, 2, K('line'));
    p.set(5, 15, K('blue'));
    p.set(5, 16, K('sky'));
    p.rect(9, 15, 3, 2, K('line'));
    p.set(10, 15, K('red'));
    p.set(10, 16, K('orange'));
    p.rect(4, 20, 8, 3, K('line'));
    p.rect(5, 21, 6, 1, K('trim-dk'));
    p.rect(3, 24, 10, 2, K('trim-sh'));
    hline(p, 3, 24, 10, K('trim-hi'));
  });
  add('water.cooler', cooler, footBottom(cooler, 1), true);

  const coatRack = S(16, 32, (p) => {
    contactShadow(p, 1, 28, 14, 4, 80);
    p.rect(3, 27, 10, 2, K('line'));
    hline(p, 4, 27, 8, K('wood-lit'));
    p.rect(7, 4, 2, 24, K('line'));
    vline(p, 7, 5, 22, K('wood-lit'));
    vline(p, 8, 5, 22, K('wood-mid'));
    for (const [x, y] of [
      [4, 6],
      [11, 6],
      [4, 13],
      [11, 13],
    ]) {
      p.rect(x, y, 2, 2, K('line'));
      p.set(x, y, K('wood-hi'));
    }
    p.rect(6, 2, 4, 2, K('line'));
    // coat on the left hook: shoulders, body, sleeve
    p.rect(1, 9, 8, 3, K('line'));
    p.rect(2, 9, 6, 2, K('red'));
    hline(p, 2, 9, 6, K('orange'));
    p.rect(2, 12, 7, 11, K('line'));
    p.rect(3, 12, 5, 10, K('red'));
    vline(p, 3, 12, 10, K('orange'));
    vline(p, 7, 12, 10, K('wine'));
    hline(p, 3, 22, 5, K('wine'));
    p.set(5, 15, K('yellow'));
    p.set(5, 18, K('yellow'));
    // scarf on the right hook
    p.rect(10, 12, 4, 8, K('line'));
    p.rect(11, 13, 2, 6, K('teal'));
    hline(p, 11, 13, 2, K('teal-hi'));
    p.set(11, 16, K('cream-hi'));
    p.set(12, 18, K('cream-hi'));
    // hat on top
    p.rect(3, 2, 4, 3, K('line'));
    p.rect(4, 2, 2, 2, K('yellow'));
  });
  add('coat.rack', coatRack, footBottom(coatRack, 1), true);

  // ------------------------------------------------------------ council
  const councilTable = S(80, 32, (p) => {
    contactShadow(p, 2, 27, 76, 5, 80);
    for (const lx of [4, 38, 73]) {
      p.rect(lx, 22, 4, 7, K('line'));
      vline(p, lx + 1, 23, 5, K('wood'));
      vline(p, lx + 2, 23, 5, K('wood-dark'));
    }
    p.rect(1, 3, 78, 21, K('line'));
    p.rect(2, 4, 76, 15, K('wood'));
    hline(p, 2, 4, 76, K('wood-lit'));
    vline(p, 2, 4, 15, K('wood-lit'));
    p.rect(2, 19, 76, 2, K('wood-dark'));
    p.rect(2, 21, 76, 2, K('wood-deep'));
    hline(p, 2, 19, 76, K('wood'));
    // runner
    p.rect(6, 7, 68, 9, K('line'));
    p.rect(7, 8, 66, 7, K('wine'));
    hline(p, 7, 8, 66, K('wine-hi'));
    hline(p, 7, 14, 66, K('wine-dk'));
    hline(p, 7, 9, 66, K('glow'));
    hline(p, 7, 13, 66, K('glow'));
    for (let x = 12; x < 72; x += 12) {
      p.set(x, 11, K('glow-hi'));
      p.set(x - 1, 11, K('glow'));
      p.set(x + 1, 11, K('glow'));
      p.set(x, 10, K('glow'));
      p.set(x, 12, K('glow'));
    }
    // goblets and papers
    for (const x of [14, 34, 56]) {
      p.rect(x, 5, 3, 4, K('line'));
      p.rect(x, 5, 3, 2, K('glow'));
      p.set(x, 5, K('glow-hi'));
    }
    paper(p, 24, 4);
    paper(p, 46, 4);
    paper(p, 64, 4);
    for (const x of [6, 72]) {
      p.rect(x, 8, 2, 2, K('glow'));
    }
  });
  add('council.table', councilTable, 'full');

  const hChair = (face) =>
    S(16, 32, (p) => {
      contactShadow(p, 3, 28, 11, 3, 80);
      if (face === 'down') {
        for (const lx of [4, 10]) {
          p.rect(lx, 24, 2, 5, K('line'));
          p.set(lx, 25, K('wood'));
        }
        // tall back behind the seat
        p.rect(3, 0, 10, 20, K('line'));
        p.rect(4, 1, 8, 18, K('wood-dark'));
        vline(p, 4, 1, 18, K('wood'));
        hline(p, 4, 1, 8, K('wood'));
        p.rect(5, 3, 6, 11, K('wine'));
        hline(p, 5, 3, 6, K('wine-hi'));
        vline(p, 5, 3, 11, K('wine-hi'));
        p.set(8, 0, K('glow'));
        p.rect(3, 18, 10, 8, K('line'));
        p.rect(4, 19, 8, 5, K('wine'));
        hline(p, 4, 19, 8, K('wine-hi'));
        hline(p, 4, 24, 8, K('wood-dark'));
        hline(p, 4, 25, 8, K('wood-deep'));
      } else if (face === 'up') {
        for (const lx of [4, 10]) {
          p.rect(lx, 24, 2, 5, K('line'));
          p.set(lx, 25, K('wood'));
        }
        p.rect(3, 8, 10, 5, K('line'));
        p.rect(4, 9, 8, 3, K('wine'));
        hline(p, 4, 9, 8, K('wine-hi'));
        p.rect(3, 12, 10, 14, K('line'));
        p.rect(4, 13, 8, 12, K('wood-dark'));
        hline(p, 4, 13, 8, K('wood'));
        vline(p, 4, 13, 12, K('wood'));
        p.rect(5, 15, 6, 8, K('wine-dk'));
        p.rect(5, 15, 6, 1, K('wine'));
        p.set(8, 12, K('glow'));
        hline(p, 4, 24, 8, K('wood-deep'));
      } else {
        // side view (facing left), tall back on the right
        for (const lx of [3, 11]) {
          p.rect(lx, 24, 2, 5, K('line'));
          p.set(lx, 25, K('wood'));
        }
        p.rect(10, 2, 4, 25, K('line'));
        p.rect(11, 3, 2, 23, K('wood-dark'));
        vline(p, 11, 3, 23, K('wood'));
        p.rect(11, 5, 1, 11, K('wine-hi'));
        p.set(11, 2, K('glow'));
        p.rect(2, 18, 10, 8, K('line'));
        p.rect(3, 19, 8, 5, K('wine'));
        hline(p, 3, 19, 8, K('wine-hi'));
        hline(p, 3, 24, 8, K('wood-dark'));
      }
    });
  const ch = (f) => hChair(f);
  add('council.chair.down', ch('down'), footBottom(ch('down'), 1), true);
  add('council.chair.up', ch('up'), footBottom(ch('up'), 1), true);
  add('council.chair.l', ch('l'), footBottom(ch('l'), 1), true);
  add('council.chair.r', flipH(ch('l')), footBottom(ch('l'), 1), true);

  // ------------------------------------------------------------ library
  const readingDesk = S(32, 24, (p) => {
    contactShadow(p, 1, 20, 30, 4, 80);
    for (const lx of [3, 26]) {
      p.rect(lx, 16, 3, 6, K('line'));
      vline(p, lx + 1, 17, 4, K('wood'));
    }
    box3(p, 1, 3, 30, 8, 14, darkWood);
    // open book
    p.rect(4, 4, 12, 6, K('line'));
    p.rect(5, 5, 5, 4, K('cream-hi'));
    p.rect(10, 5, 5, 4, K('cream'));
    vline(p, 9, 5, 4, K('tan'));
    hline(p, 6, 6, 3, K('tan'));
    hline(p, 11, 6, 3, K('tan-dark'));
    hline(p, 6, 7, 2, K('tan'));
    // banker's lamp
    p.rect(21, 3, 7, 4, K('line'));
    p.rect(22, 3, 5, 2, K('leaf'));
    hline(p, 22, 3, 5, K('leaf-hi'));
    p.rect(22, 5, 5, 1, K('leaf-dk'));
    p.rect(24, 6, 1, 3, K('line'));
    p.rect(22, 8, 5, 2, K('line'));
    p.set(23, 6, K('glow'));
    // drawer
    p.rect(11, 13, 10, 5, K('line'));
    p.rect(12, 14, 8, 3, K('wood-dark'));
    p.set(15, 15, K('glow'));
    p.set(16, 15, K('glow-hi'));
  });
  add('library.reading.desk', readingDesk, footBottom(readingDesk, 2));

  const ladder = S(16, 32, (p) => {
    contactShadow(p, 2, 28, 12, 4, 80);
    for (let y = 1; y < 29; y++) {
      const dx = Math.round((y - 1) / 14);
      for (const x of [3 + dx, 11 - dx]) {
        p.set(x, y, K('line'));
        p.set(x + 1, y, K('wood-lit'));
        p.set(x + 2, y, K('wood-mid'));
        p.set(x + 3, y, K('line'));
      }
    }
    for (let y = 5; y < 28; y += 5) {
      const dx = Math.round((y - 1) / 14);
      p.rect(6 + dx, y, 5 - dx * 2, 3, K('line'));
      hline(p, 6 + dx, y + 1, 5 - dx * 2, K('wood-hi'));
    }
  });
  add('ladder', ladder, footBottom(ladder, 1), true);

  const bookcart = S(32, 24, (p) => {
    contactShadow(p, 2, 21, 28, 3, 80);
    for (const x of [4, 24]) {
      ellipse(p, x + 2, 20.5, 3, 3, K('line'));
      ellipse(p, x + 2, 20.5, 1.5, 1.5, K('trim-dk'));
    }
    p.rect(2, 1, 28, 19, K('line'));
    p.rect(3, 2, 26, 17, K('wood'));
    vline(p, 3, 2, 17, K('wood-lit'));
    for (const [y0, seed] of [
      [3, 5],
      [11, 9],
    ]) {
      p.rect(4, y0, 24, 7, K('wood-deep'));
      shelfBooks(p, 4, 28, y0 + 7, 6, rng(seed));
      hline(p, 3, y0 + 7, 26, K('wood-hi'));
    }
    hline(p, 3, 18, 26, K('wood-dark'));
    p.rect(30, 2, 2, 10, K('line'));
    p.rect(30, 2, 1, 10, K('wood-lit'));
  });
  add('bookcart', bookcart, footBottom(bookcart, 2));

  const floorBooks = S(16, 16, (p) => {
    hline(p, 2, 13, 12, shadowCol(60));
    p.rect(2, 9, 12, 4, K('line'));
    p.rect(3, 10, 10, 2, K('blue'));
    hline(p, 3, 10, 10, K('sky'));
    p.rect(4, 6, 9, 4, K('line'));
    p.rect(5, 7, 7, 2, K('red'));
    hline(p, 5, 7, 7, K('orange'));
    p.rect(6, 3, 7, 4, K('line'));
    p.rect(7, 4, 5, 2, K('yellow'));
    hline(p, 7, 4, 5, K('glow-hi'));
    p.rect(11, 10, 1, 2, K('cream-hi'));
  });
  add('floor.books', floorBooks, 'none');

  // ------------------------------------------------------------ doors
  // Horizontal: 32x48. Leaves occupy y 7..46 (the lintel tile in the overhead layer covers y 0..6).
  const leaf = (p, x0, x1, y0, y1, tone) => {
    p.rect(x0, y0, x1 - x0, y1 - y0, K('line'));
    p.rect(x0 + 1, y0, x1 - x0 - 2, y1 - y0 - 1, K(tone[0]));
    hline(p, x0 + 1, y0, x1 - x0 - 2, K(tone[1]));
    vline(p, x0 + 1, y0, y1 - y0 - 1, K(tone[1]));
    vline(p, x1 - 2, y0 + 1, y1 - y0 - 2, K(tone[2]));
    // two recessed panels
    const pw = x1 - x0 - 6;
    for (const [py, ph] of [
      [y0 + 4, 13],
      [y0 + 20, y1 - y0 - 27],
    ]) {
      p.rect(x0 + 3, py, pw, ph, K(tone[2]));
      p.rect(x0 + 4, py + 1, pw - 2, ph - 2, K(tone[0]));
      hline(p, x0 + 4, py + ph - 2, pw - 2, K(tone[1]));
    }
  };
  const doorH = (state) =>
    S(32, 48, (p) => {
      if (state === 'open') {
        // leaves swung back against the jambs (seen edge-on), hinge pins
        for (const x of [2, 26]) {
          p.rect(x, 8, 4, 38, K('line'));
          p.rect(x + 1, 8, 2, 37, K('wood-lit'));
          vline(p, x + 1, 8, 37, K('wood-hi'));
          for (const y of [14, 30]) p.set(x + (x < 16 ? 3 : 0), y, K('trim-dk'));
        }
        return;
      }
      const locked = state === 'locked';
      const tone = locked
        ? ['wood-dark', 'wood', 'wood-deep']
        : ['wood-lit', 'wood-hi', 'wood-mid'];
      leaf(p, 2, 16, 7, 47, tone);
      leaf(p, 16, 30, 7, 47, tone);
      // meeting seam / handles
      vline(p, 15, 8, 38, K('line'));
      vline(p, 16, 8, 38, K('line'));
      for (const x of [12, 18]) {
        p.rect(x, 28, 2, 3, K('line'));
        p.set(x, 28, K(locked ? 'trim-dk' : 'glow-hi'));
        p.set(x, 29, K(locked ? 'trim-dk' : 'glow'));
      }
      if (locked) {
        // iron straps
        for (const y of [14, 36]) {
          p.rect(3, y, 26, 2, K('line'));
          hline(p, 4, y, 24, K('trim-dk'));
          for (const x of [6, 25]) p.set(x, y, K('trim-sh'));
        }
        // padlock
        p.rect(12, 20, 8, 3, K('line'));
        p.rect(13, 18, 6, 3, K('line'));
        p.rect(14, 19, 4, 2, [0, 0, 0, 0]);
        p.rect(11, 23, 10, 9, K('line'));
        p.rect(12, 24, 8, 7, K('glow'));
        hline(p, 12, 24, 8, K('glow-hi'));
        vline(p, 12, 24, 7, K('glow-hi'));
        hline(p, 12, 30, 8, K('orange'));
        vline(p, 19, 25, 6, K('orange'));
        p.rect(15, 26, 2, 3, K('line'));
        p.set(15, 29, K('line'));
        p.set(16, 29, K('line'));
      }
    });
  for (const s of ['open', 'closed', 'locked']) add(`door.h.${s}`, doorH(s), 'none');

  const doorV = (state) =>
    S(16, 32, (p) => {
      if (state === 'open') {
        // leaf swung flat against the north jamb
        p.rect(3, 1, 10, 4, K('line'));
        p.rect(4, 2, 8, 2, K('wood-lit'));
        hline(p, 4, 2, 8, K('wood-hi'));
        p.set(3, 3, K('trim-dk'));
        return;
      }
      const locked = state === 'locked';
      const tone = locked
        ? ['wood-dark', 'wood', 'wood-deep']
        : ['wood-lit', 'wood-hi', 'wood-mid'];
      p.rect(2, 0, 12, 32, K('line'));
      p.rect(3, 1, 10, 30, K(tone[0]));
      vline(p, 3, 1, 30, K(tone[1]));
      vline(p, 12, 1, 30, K(tone[2]));
      for (const x of [6, 9]) vline(p, x, 2, 28, K(tone[2]));
      hline(p, 3, 1, 10, K(tone[1]));
      for (const y of [4, 26]) {
        p.rect(3, y, 10, 2, K('line'));
        hline(p, 4, y, 8, K(locked ? 'trim-dk' : 'wood-mid'));
      }
      if (!locked) {
        p.rect(10, 15, 2, 3, K('line'));
        p.set(10, 15, K('glow-hi'));
        p.set(10, 16, K('glow'));
      } else {
        p.rect(4, 12, 8, 3, K('line'));
        p.rect(5, 10, 6, 3, K('line'));
        p.rect(6, 11, 4, 2, [0, 0, 0, 0]);
        p.rect(4, 15, 8, 8, K('line'));
        p.rect(5, 16, 6, 6, K('glow'));
        hline(p, 5, 16, 6, K('glow-hi'));
        hline(p, 5, 21, 6, K('orange'));
        p.set(7, 18, K('line'));
        p.set(8, 18, K('line'));
        p.set(8, 19, K('line'));
      }
    });
  for (const s of ['open', 'closed', 'locked']) add(`door.v.${s}`, doorV(s), 'none');

  out.notes = notes;
  return out;
}
