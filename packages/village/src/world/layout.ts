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
  // Left: chapter houses (128 px composed house art, >= 145 px pitch) and study landmarks
  S('chapter-1', 'chapter-house', 120, 128, 'left', 'Chapter 1 house'),
  S('chapter-2', 'chapter-house', 270, 128, 'left', 'Chapter 2 house'),
  S('chapter-3', 'chapter-house', 420, 128, 'left', 'Chapter 3 house'),
  S('chapter-4', 'chapter-house', 570, 128, 'left', 'Chapter 4 house'),
  S('exam-oracle', 'landmark', 690, 48, 'left', 'Exam Oracle'),
  S('feynman-porch', 'landmark', 795, 56, 'left', 'Feynman Porch'),
  // Mid: council and the landmark row
  S('debate-stage', 'landmark', 910, 80, 'mid', 'Debate Stage'),
  S('round-table', 'landmark', 1020, 64, 'mid', 'Course-Planning Round Table'),
  S('council-hall', 'council-hall', 1170, 112, 'mid', 'Council Hall'),
  S('panic-booth', 'landmark', 1290, 40, 'mid', 'Panic Line booth'),
  S('devils-ta', 'landmark', 1375, 48, 'mid', "Devil's TA"),
  S('oral-exam-hut', 'landmark', 1475, 56, 'mid', 'Oral Exam Hut'),
  S('rubric-courthouse', 'landmark', 1610, 96, 'mid', 'Rubric Courthouse'),
  // Right: mesh view (board, campfire, neighbours at >= 145 px pitch), then the trip road
  S('notice-board', 'notice-board', 1800, 48, 'right', 'Notice board'),
  S('commons', 'commons', 1930, 48, 'right', 'Campfire commons', false),
  S('home-1', 'student-home', 2095, 128, 'right', 'Neighbour house 1'),
  S('home-2', 'student-home', 2245, 128, 'right', 'Neighbour house 2'),
  S('home-3', 'student-home', 2395, 128, 'right', 'Neighbour house 3'),
  S('trip-road', 'road', 2540, 96, 'right', 'Trip road', false),
  S('spawn', 'spawn', 1235, 8, 'mid', 'Village green', false),
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
    cameraPresets: { left: 380, mid: 1120, right: 2040 },
  };
}
