import {
  GROUND_Y,
  LOGICAL_H,
  WORLD_W,
  type LayoutSlot,
  type SlotKind,
  type WorldLayout,
} from './api';

/**
 * Hand-placed world map (spec 09 decision 2). Left = study district, Mid = council + commons,
 * Right = mesh neighbours and the trip road. Rhythm: a building every ~110-130 px, gaps with
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
  // Left: chapter houses and study landmarks
  S('chapter-1', 'chapter-house', 160, 64, 'left', 'Chapter 1 house'),
  S('chapter-2', 'chapter-house', 290, 64, 'left', 'Chapter 2 house'),
  S('chapter-3', 'chapter-house', 420, 64, 'left', 'Chapter 3 house'),
  S('chapter-4', 'chapter-house', 550, 64, 'left', 'Chapter 4 house'),
  S('exam-oracle', 'landmark', 680, 48, 'left', 'Exam Oracle'),
  S('feynman-porch', 'landmark', 790, 56, 'left', 'Feynman Porch'),
  // Mid: council and commons
  S('debate-stage', 'landmark', 930, 80, 'mid', 'Debate Stage'),
  S('round-table', 'landmark', 1060, 64, 'mid', 'Course-Planning Round Table'),
  S('council-hall', 'council-hall', 1230, 112, 'mid', 'Council Hall'),
  S('commons', 'commons', 1400, 48, 'mid', 'Campfire commons', false),
  S('panic-booth', 'landmark', 1530, 40, 'mid', 'Panic Line booth'),
  S('devils-ta', 'landmark', 1650, 48, 'mid', "Devil's TA"),
  // Right: oral exam, courthouse, mesh neighbours, board, road
  S('oral-exam-hut', 'landmark', 1790, 56, 'right', 'Oral Exam Hut'),
  S('rubric-courthouse', 'landmark', 1920, 96, 'right', 'Rubric Courthouse'),
  S('notice-board', 'notice-board', 2050, 48, 'right', 'Notice board'),
  S('home-1', 'student-home', 2160, 64, 'right', 'Neighbour house 1'),
  S('home-2', 'student-home', 2280, 64, 'right', 'Neighbour house 2'),
  S('home-3', 'student-home', 2400, 64, 'right', 'Neighbour house 3'),
  S('trip-road', 'road', 2500, 96, 'right', 'Trip road', false),
  S('spawn', 'spawn', 1330, 8, 'mid', 'Village green', false),
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
    cameraPresets: { left: 400, mid: 1280, right: 2160 },
  };
}
