#!/usr/bin/env node
// Generates assets/interior/maps/demo.json (Tiled JSON, orthogonal, 16px) from the ASCII plans below.
// Run gen-tileset.mjs first (this script reads tileset.json and props.json for gids and sprite sizes).
//
// BUILDING LAYOUT (tile coordinates, 48 x 34):
//   rows 0-1 void | row 2 cap, 3 face.hi, 4 face | top rooms floor rows 5-12 | row 13 cap, 14 hi, 15 face
//   | bottom rooms floor rows 16-27 | row 28 cap, 29 hi, 30 face | rows 31-33 void.
//   Vertical dividers are cap-only columns (see lib/tiles.mjs). Walls are 3 rows tall.
//
//        0         1         2         3         4
//        0123456789012345678901234567890123456789012345678
//    2   #############################################      (top wall)
//    5   #  Classroom (4..17)  # Council (19..30) # Hall (32..42) #
//   13   ######..######....######## ... doors: commons-classroom (9,10), commons-council (21,22), library-hall (36,37)
//   16   #  Commons (4..23)        # Library (25..42)            #     door.v commons-library (col 24, rows 20-21)
//   28   #############################################             door.v council-hall (col 31, rows 8-9)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const tsJson = JSON.parse(
  readFileSync(resolve(ROOT, 'assets/interior/placeholder/tileset.json'), 'utf8'),
);
const prJson = JSON.parse(
  readFileSync(resolve(ROOT, 'assets/interior/placeholder/props.json'), 'utf8'),
).props;

const W = 48;
const H = 34;
const T = 16;

// ---------------------------------------------------------------- rooms
export const ROOMS = {
  classroom: {
    x: 4,
    y: 5,
    w: 14,
    h: 8,
    theme: 'class',
    kind: 'classroom',
    label: 'Classroom',
    snap: true,
  },
  council: {
    x: 19,
    y: 5,
    w: 12,
    h: 8,
    theme: 'council',
    kind: 'council',
    label: 'Council Room',
    snap: true,
  },
  hall: { x: 32, y: 5, w: 11, h: 8, theme: 'hall', kind: 'hall', label: 'Gallery', snap: false },
  commons: {
    x: 4,
    y: 16,
    w: 20,
    h: 12,
    theme: 'commons',
    kind: 'commons',
    label: 'Commons',
    snap: true,
  },
  library: {
    x: 25,
    y: 16,
    w: 18,
    h: 12,
    theme: 'library',
    kind: 'library',
    label: 'Library',
    snap: true,
  },
};

// door gaps: h = gap in a horizontal wall (2 wide, 3 deep: cap row + 2 face rows), x,y = top-left cell of the gap
//            v = opening in a vertical wall (1 wide, 2 tall), x,y = top cell
const DOORS = [
  { id: 'commons-classroom', a: 'commons', b: 'classroom', o: 'h', x: 9, y: 13, locked: false },
  { id: 'commons-council', a: 'commons', b: 'council', o: 'h', x: 21, y: 13, locked: true },
  { id: 'library-hall', a: 'library', b: 'hall', o: 'h', x: 36, y: 13, locked: false },
  { id: 'commons-library', a: 'commons', b: 'library', o: 'v', x: 24, y: 20, locked: false },
  { id: 'council-hall', a: 'council', b: 'hall', o: 'v', x: 31, y: 8, locked: false },
];

// ---------------------------------------------------------------- furniture plans (one char per floor cell)
// A prop's char fills its whole blocking footprint (read from props.json foot); '.' = empty floor.
// The sprite is anchored on the footprint's bottom-left; taller sprites rise above it.
const LEGEND = {
  d: 'desk.single',
  D: 'desk.double',
  u: 'chair.up',
  v: 'chair.down',
  '<': 'chair.l',
  '>': 'chair.r',
  s: 'bookshelf.small',
  S: 'bookshelf.wide',
  T: 'bookshelf.tall',
  o: 'round.table',
  t: 'table.long',
  i: 'stool',
  p: 'plant.small',
  P: 'plant.big',
  L: 'lamp.floor',
  G: 'lamp.floor.glow',
  c: 'couch',
  C: 'couch.blue',
  k: 'couch.back',
  f: 'bench',
  r: 'bean.bag.red',
  b: 'bean.bag.blue',
  y: 'bean.bag.yellow',
  x: 'toy.bin',
  g: 'globe',
  K: 'cabinet',
  w: 'water.cooler',
  a: 'coat.rack',
  R: 'library.reading.desk',
  l: 'ladder',
  q: 'bookcart',
  N: 'council.table',
  h: 'council.chair.down',
  H: 'council.chair.up',
  e: 'council.chair.l',
  E: 'council.chair.r',
};

const PLANS = {
  classroom: [
    //0123456789ABCD
    'p.s........s.p', // 0  north wall: chalkboard (5-7), windows, shelves
    '.....DD.g.....', // 1  teacher desk, globe
    '..............', // 2
    '.DD......DD...', // 3  student desks, two columns
    '.uu......uu.x.', // 4
    '.DD......DD...', // 5
    '.uu......uu.rb', // 6  play mat nook on the right (rug under rows 5-6, cols 11-13)
    '..............', // 7  door lane (door gap above cols 5-6)
  ],
  council: [
    //0123456789AB
    '............', // 0
    '.G........G.', // 1  lamps on the carpet border
    '....h.h.....', // 2  north chairs
    '...NNNNNe...', // 3  council table + head chair
    '...NNNNN....', // 4
    '....H.H.....', // 5  south chairs
    '............', // 6
    '...........P', // 7
  ],
  hall: [
    //0123456789A
    '.ff..w..ff.', // 0  benches, water cooler under frames and windows
    '...........',
    '....ttt....', // 2  gallery table
    '....ttt....',
    '...........',
    '..p.....a..',
    '...........',
    '.P.........',
  ],
  commons: [
    //01234567890123456789
    'pccc...............P', // 0  couch under the window; hearth rug and hearth at cols 8-10; notice board 12-14
    '.......G...G........', // 1  lamps by the hearth
    '....................',
    '..i.................',
    '.ioo................', // 4  round table A + stools
    '..ooi......v........',
    '...i......>oo<......', // 6  round table B + chairs
    '...........oo.......',
    '............u...r...', // 8
    '..............y.b.x.',
    '....................',
    'pkkk...KK.wa....G..P', // 11 south wall: couch (seen from behind), cabinet, cooler, coat rack
  ],
  library: [
    //012345678901234567
    'pTTTTSSl.....TTs.P', // 0  north wall of shelves, ladder
    '..................',
    '.............G....',
    '..............RR..', // 3  reading desks
    '..SSSS..SS....uu..', // 4  shelf islands -> aisles
    '..................',
    '..................',
    '..............RR..',
    '..SSSS..SS....uu..',
    '..................',
    '......qq..........',
    'p................G',
  ],
};

// flat decor placed in the furniture layer: [tileName, roomId, localX, localY]
const RUGS = [
  ...[
    ['tl', 11, 5],
    ['t', 12, 5],
    ['tr', 13, 5],
    ['bl', 11, 6],
    ['b', 12, 6],
    ['br', 13, 6],
  ].map(([n, x, y]) => [`rug.play.${n}`, 'classroom', x, y]),
  ['rug.hearth.l', 'commons', 8, 0],
  ['rug.hearth.m', 'commons', 9, 0],
  ['rug.hearth.r', 'commons', 10, 0],
  ['decal.chalk', 'classroom', 6, 2],
  ['decal.scuff', 'classroom', 4, 5],
  ['decal.scuff', 'commons', 7, 7],
  ['decal.paper', 'classroom', 7, 6],
  ['decal.book', 'commons', 15, 3],
  ['decal.scuff', 'hall', 7, 5],
  ['decal.scuff', 'library', 6, 7],
];

// wall-hung props: [prop, roomId, localX (left cell), lift px above the wall base]. Placed on the room's north wall.
const HANG = [
  ['chalkboard', 'classroom', 5, 0],
  ['wall.clock', 'classroom', 9, 14],
  ['wall.frame', 'classroom', 3, 14],
  ['wall.map', 'classroom', 12, 8],
  ['council.banner', 'council', 2, 0],
  ['council.banner', 'council', 9, 0],
  ['wall.frame.wide', 'hall', 1, 14],
  ['wall.frame.wide', 'hall', 8, 14],
  ['hearth', 'commons', 8, 0],
  ['bulletin.board', 'commons', 12, 0],
  ['wall.clock', 'commons', 11, 14],
  ['wall.frame.wide', 'commons', 3, 14],
  ['wall.clock', 'library', 16, 14],
];
// windows (face tiles with glass): [roomId, localX]  (north wall)
const WINDOWS = [
  ['classroom', 3],
  ['classroom', 10],
  ['council', 4],
  ['council', 7],
  ['hall', 3],
  ['hall', 7],
  ['commons', 1],
  ['commons', 15],
  ['commons', 16],
  ['library', 9],
  ['library', 10],
];

// floor decor floating props (zero foot): [prop, roomId, localX, localY (cell, sprite bottom on its bottom edge)]
const DECOR = [
  ['floor.books', 'library', 12, 6],
  ['floor.books', 'classroom', 4, 2],
];

// ---------------------------------------------------------------- grid construction
const idx = (x, y) => y * W + x;
const type = new Array(W * H).fill('void');
const roomAt = new Array(W * H).fill(null);
const tyAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 'void' : type[idx(x, y)]);

for (const [id, r] of Object.entries(ROOMS))
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      type[idx(x, y)] = 'floor';
      roomAt[idx(x, y)] = id;
    }

const capRect = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) type[idx(x, y)] = 'cap';
};
capRect(3, 2, 43, 2); // top wall
capRect(3, 13, 43, 13); // middle wall
capRect(3, 28, 43, 28); // bottom wall
capRect(3, 2, 3, 28); // left wall
capRect(43, 2, 43, 28); // right wall
capRect(18, 2, 18, 13); // classroom | council
capRect(31, 2, 31, 13); // council | hall
capRect(24, 13, 24, 28); // commons | library

const doorCells = (d) => {
  const cells = [];
  if (d.o === 'h')
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) cells.push([d.x + dx, d.y + dy]);
  else for (let dy = 0; dy < 2; dy++) cells.push([d.x, d.y + dy]);
  return cells;
};
for (const d of DOORS) for (const [x, y] of doorCells(d)) type[idx(x, y)] = 'gap';

// faces: two rows under every cap cell whose south neighbour is not wall/floor/gap
const faceRow = new Array(W * H).fill(0); // 1 = hi, 2 = lo
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    if (tyAt(x, y) === 'cap' && tyAt(x, y + 1) === 'void') {
      type[idx(x, y + 1)] = 'face';
      faceRow[idx(x, y + 1)] = 1;
      if (tyAt(x, y + 2) === 'void') {
        type[idx(x, y + 2)] = 'face';
        faceRow[idx(x, y + 2)] = 2;
      }
    }

// ---------------------------------------------------------------- tile helpers
const gid = (name) => {
  const i = tsJson.tiles[name];
  if (i === undefined) throw new Error(`unknown tile ${name}`);
  return i + 1;
};
const layerData = () => new Array(W * H).fill(0);
const ground = layerData();
const wall = layerData();
const furniture = layerData();
const overhead = layerData();
const collision = layerData();

const themeOfFace = (x, y) => {
  // the room this face belongs to: first floor below, else the floor above the cap, else a horizontal neighbour
  for (let yy = y + 1; yy <= y + 3; yy++)
    if (tyAt(x, yy) === 'floor') return ROOMS[roomAt[idx(x, yy)]].theme;
  for (let yy = y - 1; yy >= y - 4; yy--)
    if (tyAt(x, yy) === 'floor') return ROOMS[roomAt[idx(x, yy)]].theme;
  for (const dx of [-1, 1])
    if (tyAt(x + dx, y) === 'floor') return ROOMS[roomAt[idx(x + dx, y)]].theme;
  return 'commons';
};
const windowCells = new Set(WINDOWS.map(([r, lx]) => `${ROOMS[r].x + lx},${ROOMS[r].y - 3}`));

// ground: floors
const planksKey = (x, y) => (x * 3 + y * 5) % 3;
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const t = tyAt(x, y);
    if (t === 'void') ground[idx(x, y)] = gid('void');
    else if (t === 'gap') ground[idx(x, y)] = gid('floor.threshold');
    else if (t === 'floor') {
      const id = roomAt[idx(x, y)];
      let n;
      if (id === 'commons') n = `floor.commons.${'abc'[planksKey(x, y)]}`;
      else if (id === 'classroom') n = `floor.class.${(x + y) % 2 ? 'a' : 'b'}`;
      else if (id === 'library') n = `floor.library.${(x + (y >> 1)) % 2 ? 'a' : 'b'}`;
      else if (id === 'hall') n = (x + y) % 2 ? 'floor.corridor' : 'floor.corridor.b';
      else n = 'floor.council.wood';
      ground[idx(x, y)] = gid(n);
    } else ground[idx(x, y)] = gid('void');
  }
// council carpet: rect x 20..29, y 6..11 with border pieces
{
  const x0 = 20,
    x1 = 29,
    y0 = 6,
    y1 = 11;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const n = y === y0 ? 'n' : y === y1 ? 's' : '';
      const e = x === x0 ? 'w' : x === x1 ? 'e' : '';
      const name =
        n || e ? `floor.council.border.${n}${e}` : `floor.council.${(x + y) % 2 ? 'a' : 'b'}`;
      ground[idx(x, y)] = gid(name);
    }
}

// walls
const doorTop = new Map();
for (const d of DOORS) for (const [x, y] of doorCells(d)) doorTop.set(`${x},${y}`, d);
const isCap = (x, y) => tyAt(x, y) === 'cap';
const faceKindAt = (x, y) => {
  const hi = faceRow[idx(x, y)] === 1;
  const isWall = (xx) => tyAt(xx, y) === 'face' || tyAt(xx, y) === 'cap';
  const L = !isWall(x - 1);
  const R = !isWall(x + 1);
  let kind;
  if (L && R) kind = 'pillar';
  else if (L) kind = 'left-end';
  else if (R) kind = 'right-end';
  else if (
    windowCells.has(`${x},${y - (hi ? 1 : 2)}`) &&
    windowCells.has(`${x},${y - (hi ? 1 : 2)}`)
  )
    kind = 'window';
  else kind = hi ? 'plain' : 'skirt';
  return { hi, kind };
};
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const t = tyAt(x, y);
    if (t === 'cap') {
      const m =
        (isCap(x, y - 1) ? 1 : 0) |
        (isCap(x + 1, y) ? 2 : 0) |
        (isCap(x, y + 1) ? 4 : 0) |
        (isCap(x - 1, y) ? 8 : 0);
      wall[idx(x, y)] = gid(`wall.cap.${m}`);
      collision[idx(x, y)] = 1;
    } else if (t === 'face') {
      const th = themeOfFace(x, y);
      const { hi, kind } = faceKindAt(x, y);
      const pre = th === 'commons' ? 'wall.face' : `wall.face.${th}`;
      wall[idx(x, y)] = gid(`${pre}.${hi ? 'hi.' : ''}${kind}`);
      collision[idx(x, y)] = 1;
    } else if (t === 'void') collision[idx(x, y)] = 1;
  }
for (const d of DOORS) {
  if (d.o === 'h') {
    for (let dx = 0; dx < 2; dx++) {
      const side = dx === 0 ? 'l' : 'r';
      wall[idx(d.x + dx, d.y)] = gid(`doorway.h.top.${side}`);
      wall[idx(d.x + dx, d.y + 1)] = gid(`doorway.h.mid.${side}`);
      wall[idx(d.x + dx, d.y + 2)] = gid(`doorway.h.bot.${side}`);
      overhead[idx(d.x + dx, d.y)] = gid(`doorway.h.lintel.${side}`);
    }
  } else {
    wall[idx(d.x, d.y)] = gid('doorway.v.top');
    wall[idx(d.x, d.y + 1)] = gid('doorway.v.bot');
  }
}

// shadows (translucent) go in the furniture layer, above the opaque ground
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    if (tyAt(x, y) !== 'floor') continue;
    const top = tyAt(x, y - 1) === 'face' && faceRow[idx(x, y - 1)] === 2;
    const left = ['cap', 'face'].includes(tyAt(x - 1, y));
    if (top && left) furniture[idx(x, y)] = gid('floor.shadow.corner');
    else if (top) furniture[idx(x, y)] = gid('floor.shadow.top');
    else if (left) furniture[idx(x, y)] = gid('floor.shadow.left');
  }

const cellOf = (roomId, lx, ly) => [ROOMS[roomId].x + lx, ROOMS[roomId].y + ly];
for (const [name, rid, lx, ly] of RUGS) {
  const [x, y] = cellOf(rid, lx, ly);
  if (tyAt(x, y) !== 'floor') throw new Error(`rug ${name} off floor at ${x},${y}`);
  furniture[idx(x, y)] = gid(name);
}

// ---------------------------------------------------------------- props from plans
let nextId = 1;
const objs = { props: [], rooms: [], doors: [], waypoints: [], interactables: [], spawns: [] };
const prop = (name, rid, cx, cy, extraFoot = true) => {
  // cx,cy = footprint top-left cell (global)
  const p = prJson[name];
  if (!p) throw new Error(`unknown prop ${name}`);
  const fw = p.foot.w / T;
  const fh = p.foot.h / T;
  const left = cx * T - p.foot.x;
  const bottom = (cy + fh) * T;
  objs.props.push({
    id: nextId++,
    name,
    type: 'prop',
    x: left,
    y: bottom,
    width: p.w,
    height: p.h,
    rotation: 0,
    visible: true,
  });
  if (extraFoot)
    for (let yy = cy; yy < cy + fh; yy++)
      for (let xx = cx; xx < cx + fw; xx++) collision[idx(xx, yy)] = 1;
  return { fw, fh };
};
for (const [rid, rows] of Object.entries(PLANS)) {
  const r = ROOMS[rid];
  if (rows.length !== r.h) throw new Error(`plan ${rid}: ${rows.length} rows, expected ${r.h}`);
  rows.forEach((row) => {
    if (row.length !== r.w)
      throw new Error(`plan ${rid}: row "${row}" has ${row.length} chars, expected ${r.w}`);
  });
  const used = rows.map((row) => row.split('').map(() => false));
  for (let ly = 0; ly < r.h; ly++)
    for (let lx = 0; lx < r.w; lx++) {
      const ch = rows[ly][lx];
      if (ch === '.' || used[ly][lx]) continue;
      const name = LEGEND[ch];
      if (!name) throw new Error(`plan ${rid}: unknown char '${ch}'`);
      const p = prJson[name];
      const fw = Math.max(1, p.foot.w / T);
      const fh = Math.max(1, p.foot.h / T);
      for (let j = 0; j < fh; j++)
        for (let i = 0; i < fw; i++) {
          if (rows[ly + j]?.[lx + i] !== ch || used[ly + j][lx + i])
            throw new Error(`plan ${rid}: '${ch}' at ${lx},${ly} needs a ${fw}x${fh} block`);
          used[ly + j][lx + i] = true;
        }
      prop(name, rid, r.x + lx, r.y + ly);
    }
}
for (const [name, rid, lx, ly] of DECOR) {
  const [x, y] = cellOf(rid, lx, ly);
  const p = prJson[name];
  objs.props.push({
    id: nextId++,
    name,
    type: 'prop',
    x: x * T,
    y: (y + 1) * T,
    width: p.w,
    height: p.h,
    rotation: 0,
    visible: true,
  });
}
for (const [name, rid, lx, lift] of HANG) {
  const r = ROOMS[rid];
  const base = r.y - 1; // lower face row
  const p = prJson[name];
  const x = (r.x + lx) * T;
  objs.props.push({
    id: nextId++,
    name,
    type: 'prop',
    x,
    y: (base + 1) * T - lift,
    width: p.w,
    height: p.h,
    rotation: 0,
    visible: true,
  });
}

// ---------------------------------------------------------------- rooms, doors
for (const [id, r] of Object.entries(ROOMS)) {
  objs.rooms.push({
    id: nextId++,
    name: id,
    type: 'room',
    x: r.x * T,
    y: r.y * T,
    width: r.w * T,
    height: r.h * T,
    rotation: 0,
    visible: true,
    properties: [
      { name: 'label', type: 'string', value: r.label },
      { name: 'kind', type: 'string', value: r.kind },
      { name: 'snap', type: 'bool', value: r.snap },
    ],
  });
}
const roomOfCell = (x, y) => roomAt[idx(x, y)];
const wpDoors = [];
for (const d of DOORS) {
  const cells = doorCells(d);
  const x0 = Math.min(...cells.map((c) => c[0]));
  const y0 = Math.min(...cells.map((c) => c[1]));
  const w = d.o === 'h' ? 2 : 1;
  const h = d.o === 'h' ? 3 : 2;
  objs.doors.push({
    id: nextId++,
    name: `door-${d.id}`,
    type: 'door',
    x: x0 * T,
    y: y0 * T,
    width: w * T,
    height: h * T,
    rotation: 0,
    visible: true,
    properties: [
      { name: 'a', type: 'string', value: d.a },
      { name: 'b', type: 'string', value: d.b },
      { name: 'locked', type: 'bool', value: d.locked },
      { name: 'prop', type: 'string', value: d.o === 'h' ? 'door.h' : 'door.v' },
      { name: 'spriteX', type: 'int', value: x0 * T },
      { name: 'spriteY', type: 'int', value: (y0 + h) * T },
    ],
  });
  // approach cells on either side
  const sides =
    d.o === 'h'
      ? [
          [x0, y0 - 1],
          [x0, y0 + 3],
        ]
      : [
          [x0 - 1, y0],
          [x0 + 1, y0],
        ];
  for (const [cx, cy] of sides) {
    const rid = roomOfCell(cx, cy);
    if (!rid) throw new Error(`door ${d.id}: approach cell ${cx},${cy} is not a room`);
    const which = rid === d.a ? 'a' : rid === d.b ? 'b' : null;
    if (!which) throw new Error(`door ${d.id}: approach cell belongs to ${rid}`);
    wpDoors.push({ name: `door.${d.id}.${which}`, room: rid, x: cx * T + 8, y: cy * T + 8 });
  }
}

// ---------------------------------------------------------------- waypoints, interactables, spawns
const centre = (rid, lx, ly) => {
  const [x, y] = cellOf(rid, lx, ly);
  return { x: x * T + 8, y: y * T + 8 };
};
const WP = {
  commons: {
    'commons.center': [9, 8],
    'commons.hearth': [9, 1],
    'commons.board': [13, 1],
    'commons.table-a': [5, 4],
    'commons.table-b': [14, 7],
    'commons.couch': [2, 1],
    'commons.lounge': [15, 9],
    'commons.south': [5, 9],
  },
  classroom: {
    'classroom.desk-1': [3, 4],
    'classroom.desk-2': [8, 4],
    'classroom.desk-3': [3, 6],
    'classroom.desk-4': [8, 6],
    'classroom.mat': [12, 5],
    'classroom.teacher': [7, 1],
    'classroom.board': [6, 2],
  },
  council: {
    'council.seat-1': [4, 1],
    'council.seat-2': [6, 1],
    'council.seat-3': [4, 6],
    'council.seat-4': [6, 6],
    'council.seat-5': [9, 3],
    'council.head': [9, 4],
    'council.center': [2, 4],
  },
  library: {
    'library.aisle-1': [6, 5],
    'library.aisle-2': [6, 9],
    'library.aisle-3': [10, 5],
    'library.reading': [13, 5],
    'library.reading-2': [13, 9],
    'library.ladder': [7, 1],
    'library.shelf': [9, 2],
  },
  hall: {
    'hall.center': [5, 5],
    'hall.bench-1': [1, 1],
    'hall.bench-2': [9, 1],
    'hall.table': [3, 3],
    'hall.south': [8, 6],
    'hall.west': [1, 4],
  },
};
for (const [rid, wps] of Object.entries(WP))
  for (const [name, [lx, ly]] of Object.entries(wps)) {
    const c = centre(rid, lx, ly);
    objs.waypoints.push({
      id: nextId++,
      name,
      type: 'waypoint',
      x: c.x,
      y: c.y,
      width: 0,
      height: 0,
      rotation: 0,
      visible: true,
      point: true,
      properties: [{ name: 'room', type: 'string', value: rid }],
    });
  }
for (const w of wpDoors)
  objs.waypoints.push({
    id: nextId++,
    name: w.name,
    type: 'waypoint',
    x: w.x,
    y: w.y,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    properties: [{ name: 'room', type: 'string', value: w.room }],
  });

const INTER = [
  ['notice-board', 'Read the notice board', 'commons', 'ledger', centre('commons', 13, 1), 20],
  ['hearth', 'Warm up by the hearth', 'commons', 'hearth', centre('commons', 9, 1), 20],
  ['chalkboard', 'Open the chalkboard quiz', 'classroom', 'quiz', centre('classroom', 6, 2), 20],
  ['globe', 'Spin the globe', 'classroom', 'toy', centre('classroom', 8, 2), 18],
  ['council-table', 'Join the council table', 'council', 'council', centre('council', 2, 4), 24],
  ['library-desk', 'Sit at the reading desk', 'library', 'study', centre('library', 13, 5), 20],
  ['library-shelf', 'Browse the shelves', 'library', 'shelf', centre('library', 9, 2), 20],
];
for (const [name, label, room, kind, c, radius] of INTER)
  objs.interactables.push({
    id: nextId++,
    name,
    type: 'interactable',
    x: c.x,
    y: c.y,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    properties: [
      { name: 'label', type: 'string', value: label },
      { name: 'room', type: 'string', value: room },
      { name: 'radius', type: 'int', value: radius },
      { name: 'kind', type: 'string', value: kind },
    ],
  });

const SPAWN = [
  ['player', 'commons', 9, 9],
  ['npc.1', 'commons', 15, 3],
  ['npc.2', 'classroom', 7, 3],
  ['npc.3', 'council', 2, 3],
  ['npc.4', 'library', 6, 6],
  ['npc.5', 'hall', 8, 3],
  ['npc.6', 'commons', 4, 8],
];
for (const [name, rid, lx, ly] of SPAWN) {
  const c = centre(rid, lx, ly);
  objs.spawns.push({
    id: nextId++,
    name,
    type: 'spawn',
    x: c.x,
    y: c.y,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    properties: [{ name: 'room', type: 'string', value: rid }],
  });
}

// ---------------------------------------------------------------- BFS reachability check (locked doors count as open)
const cellOfPx = (x, y) => [Math.floor(x / T), Math.floor(y / T)];
{
  const seen = new Uint8Array(W * H);
  const [sx, sy] = cellOfPx(objs.spawns[0].x, objs.spawns[0].y);
  if (collision[idx(sx, sy)]) throw new Error('player spawn is blocked');
  const q = [[sx, sy]];
  seen[idx(sx, sy)] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[idx(nx, ny)] || collision[idx(nx, ny)])
        continue;
      seen[idx(nx, ny)] = 1;
      q.push([nx, ny]);
    }
  }
  const check = (kind, o) => {
    const [cx, cy] = cellOfPx(o.x, o.y);
    if (collision[idx(cx, cy)])
      throw new Error(`${kind} ${o.name} sits on a blocked cell (${cx},${cy})`);
    if (!seen[idx(cx, cy)])
      throw new Error(`${kind} ${o.name} is unreachable from the player spawn (${cx},${cy})`);
  };
  [...objs.waypoints, ...objs.spawns, ...objs.interactables].forEach((o) => check(o.type, o));
  for (const d of objs.doors) {
    // every doorway cell must be reachable
    for (let y = d.y / T; y < (d.y + d.height) / T; y++)
      for (let x = d.x / T; x < (d.x + d.width) / T; x++)
        if (!seen[idx(x, y)]) throw new Error(`door ${d.name} cell ${x},${y} unreachable`);
  }
  // no pockets: every unblocked cell inside a room must be reachable
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (tyAt(x, y) === 'floor' && !collision[idx(x, y)] && !seen[idx(x, y)])
        throw new Error(`walkable floor cell ${x},${y} is cut off`);
  // 2-wide lane check from each door approach to the player spawn is covered by reachability; report free cells
  let free = 0;
  for (let i = 0; i < W * H; i++) if (seen[i]) free++;
  console.log(`BFS ok: ${free} walkable cells reachable from the player spawn`);
}

// ---------------------------------------------------------------- Tiled JSON
const tileLayer = (id, name, data, visible = true) => ({
  id,
  name,
  type: 'tilelayer',
  x: 0,
  y: 0,
  width: W,
  height: H,
  opacity: 1,
  visible,
  data,
});
const objLayer = (id, name, objects) => ({
  id,
  name,
  type: 'objectgroup',
  x: 0,
  y: 0,
  opacity: 1,
  visible: true,
  draworder: 'topdown',
  objects,
});
let lid = 1;
const layers = [
  tileLayer(lid++, 'ground', ground),
  tileLayer(lid++, 'wall', wall),
  tileLayer(lid++, 'furniture', furniture),
  tileLayer(lid++, 'overhead', overhead),
  tileLayer(lid++, 'collision', collision, false),
  objLayer(lid++, 'rooms', objs.rooms),
  objLayer(lid++, 'doors', objs.doors),
  objLayer(lid++, 'waypoints', objs.waypoints),
  objLayer(lid++, 'interactables', objs.interactables),
  objLayer(lid++, 'props', objs.props),
  objLayer(lid++, 'spawns', objs.spawns),
];
// validate gids
const maxGid = tsJson.tileCount;
for (const l of layers.filter((l) => l.type === 'tilelayer')) {
  if (l.data.length !== W * H) throw new Error(`layer ${l.name} length`);
  for (const g of l.data) if (g < 0 || g > maxGid) throw new Error(`layer ${l.name}: bad gid ${g}`);
}
const map = {
  compressionlevel: -1,
  height: H,
  width: W,
  infinite: false,
  layers,
  nextlayerid: lid,
  nextobjectid: nextId,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  tiledversion: '1.10.2',
  tileheight: T,
  tilewidth: T,
  type: 'map',
  version: '1.10',
  tilesets: [
    {
      firstgid: 1,
      name: 'placeholder-interior',
      image: '../placeholder/tileset.png',
      imagewidth: tsJson.imageWidth,
      imageheight: tsJson.imageHeight,
      tilewidth: T,
      tileheight: T,
      tilecount: tsJson.tileCount,
      columns: tsJson.columns,
      margin: 0,
      spacing: 0,
    },
  ],
  properties: [
    { name: 'name', type: 'string', value: 'Squad demo campus' },
    { name: 'defaultRoom', type: 'string', value: 'commons' },
  ],
};
const out = resolve(ROOT, 'assets/interior/maps/demo.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(map) + '\n');
console.log(
  `map ${W}x${H}: ${objs.props.length} props, ${objs.doors.length} doors, ${objs.waypoints.length} waypoints -> ${out}`,
);
