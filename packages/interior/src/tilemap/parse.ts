import { z } from 'zod';
import type {
  DoorDef,
  InteractableDef,
  InteriorMap,
  PropDef,
  PropPlacement,
  PropsDef,
  Rect,
  RoomDef,
  SpawnDef,
  TileLayerName,
  TilesetDef,
  WaypointDef,
} from './types';
import { TILE } from './types';

const GID_MASK = 0x1fffffff;

const PropertyArr = z.array(
  z.object({ name: z.string(), type: z.string().optional(), value: z.unknown() }),
);
const Properties = z.union([PropertyArr, z.record(z.string(), z.unknown())]).optional();

const TiledObject = z.object({
  id: z.number().optional(),
  name: z.string().default(''),
  type: z.string().optional(),
  class: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().default(0),
  height: z.number().default(0),
  point: z.boolean().optional(),
  properties: Properties,
});
type TiledObject = z.infer<typeof TiledObject>;

const TiledLayer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tilelayer'),
    name: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    data: z.array(z.number()),
  }),
  z.object({ type: z.literal('objectgroup'), name: z.string(), objects: z.array(TiledObject) }),
]);

export const TiledMapSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.literal(TILE),
  tileheight: z.literal(TILE),
  layers: z.array(TiledLayer),
  tilesets: z.array(
    z.object({
      firstgid: z.number().int(),
      image: z.string().optional(),
      columns: z.number().int().optional(),
      source: z.string().optional(),
    }),
  ),
  properties: Properties,
});

const props = (p: z.infer<typeof Properties>): Record<string, unknown> => {
  if (!p) return {};
  if (Array.isArray(p)) return Object.fromEntries(p.map((e) => [e.name, e.value]));
  return p;
};
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const rectOf = (o: TiledObject): Rect => ({ x: o.x, y: o.y, w: o.width, h: o.height });

export class MapParseError extends Error {}

/** Parse and validate Tiled JSON into the engine map. Throws MapParseError with a precise message. */
export function parseTiledMap(json: unknown): InteriorMap {
  const parsed = TiledMapSchema.safeParse(json);
  if (!parsed.success) throw new MapParseError(`Invalid Tiled map: ${parsed.error.message}`);
  const m = parsed.data;
  const size = m.width * m.height;
  const tileLayers = new Map<string, number[]>();
  const objLayers = new Map<string, TiledObject[]>();
  for (const l of m.layers) {
    if (l.type === 'tilelayer') {
      if (l.data.length !== size)
        throw new MapParseError(`Layer "${l.name}" has ${l.data.length} cells, expected ${size}`);
      tileLayers.set(l.name, l.data);
    } else objLayers.set(l.name, l.objects);
  }
  const layer = (name: string, required: boolean): Int32Array => {
    const d = tileLayers.get(name);
    if (!d) {
      if (required) throw new MapParseError(`Missing tile layer "${name}"`);
      return new Int32Array(size);
    }
    return Int32Array.from(d, (g) => g & GID_MASK);
  };
  const objs = (name: string) => objLayers.get(name) ?? [];

  const rooms: RoomDef[] = objs('rooms').map((o) => {
    const p = props(o.properties);
    return {
      id: o.name,
      label: str(p.label, o.name),
      kind: str(p.kind, 'room'),
      snap: bool(p.snap),
      bounds: rectOf(o),
    };
  });
  const roomIds = new Set(rooms.map((r) => r.id));
  const doors: DoorDef[] = objs('doors').map((o) => {
    const p = props(o.properties);
    const d: DoorDef = {
      id: o.name,
      a: str(p.a),
      b: str(p.b),
      locked: bool(p.locked),
      prop: str(p.prop, o.width >= o.height ? 'door.h' : 'door.v'),
      rect: rectOf(o),
      spriteX: num(p.spriteX, o.x),
      spriteY: num(p.spriteY, o.y + o.height),
    };
    for (const r of [d.a, d.b])
      if (r && !roomIds.has(r))
        throw new MapParseError(`Door "${d.id}" references unknown room "${r}"`);
    return d;
  });
  const waypoints: WaypointDef[] = objs('waypoints').map((o) => ({
    name: o.name,
    room: str(props(o.properties).room) || undefined,
    x: o.x,
    y: o.y,
  }));
  const interactables: InteractableDef[] = objs('interactables').map((o) => {
    const p = props(o.properties);
    return {
      id: o.name,
      label: str(p.label, o.name),
      room: str(p.room) || undefined,
      radius: num(p.radius, 20),
      kind: str(p.kind, 'generic'),
      // Rect objects are anchored by their centre.
      x: o.point ? o.x : o.x + o.width / 2,
      y: o.point ? o.y : o.y + o.height / 2,
    };
  });
  const placements: PropPlacement[] = objs('props').map((o) => ({
    name: o.name,
    x: o.x,
    y: o.y,
    w: o.width,
    h: o.height,
    flip: bool(props(o.properties).flip),
  }));
  const spawns: SpawnDef[] = objs('spawns').map((o) => ({ name: o.name, x: o.x, y: o.y }));

  const ts = m.tilesets[0];
  if (!ts) throw new MapParseError('Map has no tileset');
  const mp = props(m.properties);
  return {
    name: str(mp.name, 'interior'),
    width: m.width,
    height: m.height,
    pxW: m.width * TILE,
    pxH: m.height * TILE,
    layers: {
      ground: layer('ground', true),
      wall: layer('wall', false),
      furniture: layer('furniture', false),
      overhead: layer('overhead', false),
    } satisfies Record<TileLayerName, Int32Array>,
    collision: Uint8Array.from(layer('collision', true), (g) => (g ? 1 : 0)),
    rooms,
    doors,
    waypoints,
    interactables,
    props: placements,
    spawns,
    tileset: { firstgid: ts.firstgid, image: ts.image ?? '', columns: ts.columns ?? 16 },
    defaultRoom: str(mp.defaultRoom) || undefined,
  };
}

const PropsJson = z.object({
  props: z.record(
    z.string(),
    z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      foot: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
      tall: z.boolean().optional(),
    }),
  ),
});

export function parsePropsDef(json: unknown): PropsDef {
  const p = PropsJson.safeParse(json);
  if (!p.success) throw new MapParseError(`Invalid props atlas: ${p.error.message}`);
  const out = new Map<string, PropDef>();
  for (const [name, v] of Object.entries(p.data.props))
    out.set(name, { name, x: v.x, y: v.y, w: v.w, h: v.h, foot: v.foot, tall: v.tall ?? false });
  return out;
}

const TilesetJson = z.object({
  name: z.string().default('tileset'),
  tileSize: z.literal(TILE),
  image: z.string(),
  columns: z.number().int().positive(),
  tiles: z.record(z.string(), z.number().int()),
});
export function parseTilesetDef(json: unknown): TilesetDef {
  const t = TilesetJson.safeParse(json);
  if (!t.success) throw new MapParseError(`Invalid tileset: ${t.error.message}`);
  return t.data;
}
