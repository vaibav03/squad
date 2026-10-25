import { drawText, textWidth } from '../scenes/pixel/font';
import type { Raster } from '../scenes/pixel/raster';
import {
  ARROW_PACKET_SIZE,
  ARROW_WINDOW_MS,
  arcAt,
  arcPoints,
  arrowHead,
  planArrows,
  seatPositions,
  type Pt,
  type SeatRef,
} from './arrows';
import type { CouncilBoardStore } from './store';

const HEAD_Y = 26;

/**
 * Paints the message arrows between the seats of a room interior into its raster (interior px). Returns true while
 * any arrow is on screen so the host keeps repainting. Same width, same violet, arrowhead for direction; Calm mode
 * draws the static arc and label only.
 */
export function paintRoomArrows(
  r: Raster,
  board: Pick<CouncilBoardStore, 'links'> | undefined,
  seats: readonly SeatRef[],
  roomAgent: string,
  calm: boolean,
  now = Date.now(),
): boolean {
  if (!board || seats.length === 0) return false;
  const mapped = seatPositions(board.links(ARROW_WINDOW_MS), seats, roomAgent);
  const positions = new Map<string, Pt>();
  for (const [id, p] of mapped.positions) positions.set(id, { x: p.x, y: p.y - HEAD_Y });
  const arrows = planArrows(mapped.links, positions, { calm, now });
  for (const a of arrows) {
    const p0 = positions.get(a.from)!;
    const p1 = positions.get(a.to)!;
    for (const p of arcPoints(p0, p1, 40))
      r.px(Math.round(p.x), Math.round(p.y), 'violet', a.alpha);
    const [tip, l, rr] = arrowHead(p0, p1);
    fillTri(r, tip, l, rr, a.alpha);
    if (a.packetT !== null) {
      const q = arcAt(p0, p1, a.packetT);
      r.rect(
        Math.round(q.x) - 1,
        Math.round(q.y) - 1,
        ARROW_PACKET_SIZE,
        ARROW_PACKET_SIZE,
        'cloud-hi',
      );
    }
    if (a.alpha > 0.25) {
      const mid = arcAt(p0, p1, 0.5);
      drawText(
        r,
        Math.round(mid.x - textWidth(a.label) / 2),
        Math.round(mid.y) - 8,
        a.label,
        'cloud-hi',
      );
    }
  }
  return arrows.length > 0;
}

function fillTri(r: Raster, a: Pt, b: Pt, c: Pt, alpha: number): void {
  const minX = Math.floor(Math.min(a.x, b.x, c.x));
  const maxX = Math.ceil(Math.max(a.x, b.x, c.x));
  const minY = Math.floor(Math.min(a.y, b.y, c.y));
  const maxY = Math.ceil(Math.max(a.y, b.y, c.y));
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) || 1;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
      const w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.1 && w1 >= -0.1 && w2 >= -0.1) r.px(x, y, 'violet', alpha);
    }
}
