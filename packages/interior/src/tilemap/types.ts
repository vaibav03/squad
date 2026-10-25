/** Parsed, engine-side shapes of a Tiled map. Phaser-free: safe to import anywhere. */
export const TILE = 16;

export type Dir = 'down' | 'up' | 'left' | 'right';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomDef {
  id: string;
  label: string;
  kind: string;
  /** Camera room-snap participates for this room. */
  snap: boolean;
  /** Walkable floor bounds, whole pixels. */
  bounds: Rect;
}

export interface DoorDef {
  id: string;
  /** Room ids on either side. */
  a: string;
  b: string;
  locked: boolean;
  /** 'door.h' | 'door.v'; the engine appends .open / .closed / .locked. */
  prop: string;
  /** Doorway floor tiles in pixels (2 tiles). */
  rect: Rect;
  /** Pixel bottom-left of the door sprite. */
  spriteX: number;
  spriteY: number;
}

export interface WaypointDef {
  name: string;
  room: string | undefined;
  x: number;
  y: number;
}

export interface InteractableDef {
  id: string;
  label: string;
  room: string | undefined;
  radius: number;
  kind: string;
  x: number;
  y: number;
}

export interface PropPlacement {
  name: string;
  /** Pixel bottom-left of the sprite. */
  x: number;
  y: number;
  w: number;
  h: number;
  flip: boolean;
}

export interface SpawnDef {
  name: string;
  x: number;
  y: number;
}

export type TileLayerName = 'ground' | 'wall' | 'furniture' | 'overhead';

export interface InteriorMap {
  name: string;
  /** Size in tiles. */
  width: number;
  height: number;
  pxW: number;
  pxH: number;
  layers: Record<TileLayerName, Int32Array>;
  /** 1 = blocked (authored collision layer only; props and doors are unioned by buildCollision). */
  collision: Uint8Array;
  rooms: RoomDef[];
  doors: DoorDef[];
  waypoints: WaypointDef[];
  interactables: InteractableDef[];
  props: PropPlacement[];
  spawns: SpawnDef[];
  tileset: { firstgid: number; image: string; columns: number };
  defaultRoom: string | undefined;
}

export interface PropDef {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Blocking footprint relative to the sprite top-left (tile aligned), if any. */
  foot: Rect | undefined;
  tall: boolean;
}

export type PropsDef = ReadonlyMap<string, PropDef>;

export interface TilesetDef {
  name: string;
  tileSize: number;
  image: string;
  columns: number;
  tiles: Record<string, number>;
}
