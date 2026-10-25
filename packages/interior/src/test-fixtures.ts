/** Hand-built Tiled JSON used by unit tests: two rooms joined by one door. Not shipped. */
export const FIXTURE_W = 20;
export const FIXTURE_H = 10;

/**
 * Plan (# wall, . floor, D door tiles, 'T' table prop footprint authored separately):
 *
 *   ####################
 *   #........#.........#
 *   #........#.........#
 *   #........D.........#
 *   #........D.........#
 *   #........#.........#
 *   ####################   (rows 6..9 void, blocked)
 */
const PLAN = [
  '####################',
  '#........#.........#',
  '#........#.........#',
  '#........D.........#',
  '#........D.........#',
  '#........#.........#',
  '####################',
  '####################',
  '####################',
  '####################',
];

export function fixtureMapJson(opts: { locked?: boolean } = {}) {
  const collision: number[] = [];
  const ground: number[] = [];
  for (const row of PLAN)
    for (const c of row) {
      collision.push(c === '#' ? 1 : 0);
      ground.push(c === '#' ? 0 : 1);
    }
  const obj = (
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    props: Record<string, unknown> = {},
    extra = {},
  ) => ({
    id: Math.random(),
    name,
    x,
    y,
    width: w,
    height: h,
    properties: Object.entries(props).map(([k, v]) => ({ name: k, type: typeof v, value: v })),
    ...extra,
  });
  const pt = (name: string, x: number, y: number, props: Record<string, unknown> = {}) =>
    obj(name, x, y, 0, 0, props, { point: true });
  return {
    width: FIXTURE_W,
    height: FIXTURE_H,
    tilewidth: 16,
    tileheight: 16,
    properties: [
      { name: 'name', type: 'string', value: 'fixture' },
      { name: 'defaultRoom', type: 'string', value: 'left' },
    ],
    tilesets: [{ firstgid: 1, image: 'tileset.png', columns: 16 }],
    layers: [
      { type: 'tilelayer', name: 'ground', width: FIXTURE_W, height: FIXTURE_H, data: ground },
      {
        type: 'tilelayer',
        name: 'wall',
        width: FIXTURE_W,
        height: FIXTURE_H,
        data: ground.map((g) => (g ? 0 : 2)),
      },
      {
        type: 'tilelayer',
        name: 'collision',
        width: FIXTURE_W,
        height: FIXTURE_H,
        data: collision,
      },
      {
        type: 'objectgroup',
        name: 'rooms',
        objects: [
          obj('left', 16, 16, 128, 80, { label: 'Left', kind: 'commons', snap: true }),
          obj('right', 160, 16, 144, 80, { label: 'Right', kind: 'classroom', snap: true }),
        ],
      },
      {
        type: 'objectgroup',
        name: 'doors',
        objects: [
          obj('door-left-right', 144, 48, 16, 32, {
            a: 'left',
            b: 'right',
            locked: !!opts.locked,
            prop: 'door.v',
            spriteX: 144,
            spriteY: 80,
          }),
        ],
      },
      {
        type: 'objectgroup',
        name: 'waypoints',
        objects: [
          pt('left.a', 40, 40, { room: 'left' }),
          pt('left.b', 104, 72, { room: 'left' }),
          pt('right.a', 200, 40, { room: 'right' }),
          pt('right.b', 264, 72, { room: 'right' }),
          pt('door.left-right.a', 136, 56, { room: 'left' }),
          pt('door.left-right.b', 168, 56, { room: 'right' }),
        ],
      },
      {
        type: 'objectgroup',
        name: 'interactables',
        objects: [
          pt('board', 56, 40, {
            label: 'Read the board',
            room: 'left',
            radius: 20,
            kind: 'ledger',
          }),
        ],
      },
      {
        type: 'objectgroup',
        name: 'props',
        objects: [obj('table', 64, 64, 32, 32, {}, { type: 'prop' })],
      },
      {
        type: 'objectgroup',
        name: 'spawns',
        objects: [pt('player', 40, 40), pt('npc.1', 200, 40)],
      },
    ],
  };
}

export const FIXTURE_PROPS = {
  props: {
    table: { x: 0, y: 0, w: 32, h: 32, foot: { x: 0, y: 16, w: 32, h: 16 }, tall: false },
  },
};
