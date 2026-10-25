import {
  GROUND_Y,
  LOGICAL_H,
  WORLD_W,
  type LayoutSlot,
  type SlotKind,
  type WorldLayout,
} from './api';

/**
 * Hand-placed world map (spec 09 decision 2). Left = study district, Mid = council + landmark row,
 * Right = mesh view (board, campfire commons, neighbours within ~300 px) and the trip road. Rhythm: a building every ~110-130 px, gaps with
 * lamps/trees between, so any 320 px window holds two or three silhouettes.
 */
const S = (
  id: string,
  kind: SlotKind,
  x: number,
  w: number,
  region: LayoutSlot['region'],
  label: string,
  door = true,
): LayoutSlot => ({ id, kind, x, w, region, label, ...(door ? { door: { x } } : {}) });

export const SLOTS: readonly LayoutSlot[] = [
  // The Mastery board stands at the entrance of the study district, just left of the first chapter house.
  S('mastery-board', 'mastery-board', 30, 40, 'left', 'Mastery board'),
  // Left: chapter houses (hut art 128 px wide, 160 px pitch) and study landmarks. Widths are the real art widths
  // from assets/asset-manifest.json; gaps between footprints are >= 32 px.
  S('chapter-1', 'chapter-house', 120, 128, 'left', 'Chapter 1 house'),
  S('chapter-2', 'chapter-house', 280, 128, 'left', 'Chapter 2 house'),
  S('chapter-3', 'chapter-house', 440, 128, 'left', 'Chapter 3 house'),
  S('chapter-4', 'chapter-house', 600, 128, 'left', 'Chapter 4 house'),
  S('exam-oracle', 'landmark', 732, 63, 'left', 'Exam Oracle'),
  S('feynman-porch', 'landmark', 857, 114, 'left', 'Feynman Porch'),
  // Mid: debate stage, round table, council hall and the landmark row
  S('debate-stage', 'landmark', 1048, 197, 'mid', 'Debate Stage'),
  S('round-table', 'landmark', 1244, 124, 'mid', 'Course-Planning Round Table'),
  S('council-hall', 'council-hall', 1412, 139, 'mid', 'Council Hall'),
  S('panic-booth', 'landmark', 1532, 28, 'mid', 'Panic Line booth'),
  S('devils-ta', 'landmark', 1649, 134, 'mid', "Devil's TA"),
  S('oral-exam-hut', 'landmark', 1789, 73, 'mid', 'Oral Exam Hut'),
  S('rubric-courthouse', 'landmark', 1924, 123, 'mid', 'Rubric Courthouse'),
  // Right: mesh view in one 427 px window (board, campfire, first neighbour), then more homes and the trip road
  S('notice-board', 'notice-board', 2050, 64, 'right', 'Notice board'),
  S('commons', 'commons', 2160, 48, 'right', 'Campfire commons', false),
  S('home-1', 'student-home', 2300, 128, 'right', 'Neighbour house 1'),
  S('home-2', 'student-home', 2450, 128, 'right', 'Neighbour house 2'),
  S('home-3', 'student-home', 2600, 128, 'right', 'Neighbour house 3'),
  S('trip-road', 'road', 2770, 96, 'right', 'Trip road', false),
  S('spawn', 'spawn', 1490, 8, 'mid', 'Village green', false),
];

export function createLayout(): WorldLayout {
  const byId = new Map(SLOTS.map((s) => [s.id, s]));
  return {
    width: WORLD_W,
    height: LOGICAL_H,
    groundY: GROUND_Y,
    slots: SLOTS,
    slot(id) {
      const s = byId.get(id);
      if (!s) throw new Error(`unknown layout slot "${id}"`);
      return s;
    },
    slotsOfKind: (kind) => SLOTS.filter((s) => s.kind === kind),
    cameraPresets: { left: 400, mid: 1300, right: 2200 },
  };
}
