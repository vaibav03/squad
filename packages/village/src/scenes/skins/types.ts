/**
 * Optional art skins for room interiors (224x128 art px). A skin swaps the composed background and adds an
 * optional layer drawn between the chairman and the members, plus per-skin anchors. Everything here is DATA:
 * the recipe names tiles by pack-relative path and rectangle (no pixels), and the layout holds the seat anchors
 * the painters and the click/Tab hit zones both read. See docs/interior-skin.md.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface SeatAnchor extends Pt {
  /** Mirror the character (members on the right face left). */
  flip: boolean;
}

/** Per-skin anchors for one room. Feet positions in interior px, the same space as roomSeats. */
export interface SkinLayout {
  /** Council members: left, front, right. */
  seats: [SeatAnchor, SeatAnchor, SeatAnchor];
  /** The chairman behind the table. */
  chair: Pt;
  /** Speech-bubble row slots (x per rank position) and the bubble tail tip y. */
  rowX: [number, number, number];
  rowTip: number;
  /** Where the dissent lantern hangs and where the plan sheet is pinned. */
  lantern: [number, number];
  planSheet: [number, number];
  /** Faint violet floor ring while a session runs (classic art has an inscription it echoes). */
  floorRing: boolean;
  /** Where the player stands when the interior opens. */
  entry: Pt;
}

export type Rect = { x: number; y: number; w: number; h: number };

export interface SpriteRef extends Rect {
  /** Key in `Recipe.sheets`. */
  sheet: string;
}

/** One drawing step. Coordinates are interior px, top-left based. */
export type Op =
  | { op: 'tile'; sprite: string; x: number; y: number; w: number; h: number }
  | { op: 'put'; sprite: string; x: number; y: number; flip?: boolean }
  | { op: 'span'; left: string; mid: string; right: string; x: number; y: number; w: number }
  | { op: 'fill'; x: number; y: number; w: number; h: number; color: string; alpha?: number };

export type LayerName = 'bg' | 'mid' | 'fg';

export interface Recipe {
  id: string;
  /** Scene id the skin belongs to (council-hall). */
  scene: string;
  title: string;
  credit: string;
  size: [number, number];
  /** Sheet key -> path inside the pack (zip entry name, forward slashes). */
  sheets: Record<string, string>;
  sprites: Record<string, SpriteRef>;
  layers: { bg: Op[]; mid?: Op[]; fg?: Op[] };
  layout: SkinLayout;
}

/** What the importer writes next to the layer PNGs (gitignored, local only). */
export interface SkinManifest {
  version: 1;
  id: string;
  scene: string;
  title: string;
  credit: string;
  size: [number, number];
  /** Layer name -> file name inside the skin folder. */
  layers: Partial<Record<LayerName, string>>;
  layout: SkinLayout;
}

export const SKIN_ROOT = 'assets/vendor/interiors';
export const SKIN_INDEX = `${SKIN_ROOT}/index.json`;
export const CREDIT_LINE = 'World art: Modern Interiors by LimeZu';

/** assets/vendor/interiors/index.json: scene id -> manifest path (relative to SKIN_ROOT). */
export interface SkinIndex {
  version: 1;
  skins: Record<string, string>;
}
