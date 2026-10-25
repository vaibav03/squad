import type { VillageEvent } from '@squad/core';
import type { SceneBundle, SceneDef, SceneCommand, SceneCtx, ShotDef } from '../contract';
import { initBase, reduceBase, type BaseState } from '../model/base';
import { chapterLabel } from '../art/chapter-house-kit';
import { CH_DOOR, CH_EXT_H, CH_EXT_W, paintChapterExterior } from '../art/chapter-house-exterior';
import { CH_ENTRY, CH_INT_H, CH_INT_W, paintChapterInterior } from '../art/chapter-house-interior';
import { handlesChapter, mapChapterEvent } from './map';
import { shotBundles } from './shots';

export type ChapterHouseState = BaseState;

function signText(title: string): string {
  return title.toUpperCase().slice(0, 12);
}

export const chapterHouse: SceneDef<ChapterHouseState> = {
  id: 'chapter-house',
  kind: 'chapter-house',
  title: 'Chapter house',
  exterior: { w: CH_EXT_W, h: CH_EXT_H },
  interior: { w: CH_INT_W, h: CH_INT_H },
  door: { x: CH_DOOR.x, y: CH_DOOR.y },
  entry: { x: CH_ENTRY.x, y: CH_ENTRY.y },
  init(opts) {
    const instance = opts?.instance ?? 'ch1';
    const title = opts?.title?.trim() || chapterLabel(instance);
    return initBase({ instance, title, access: 'dim', sign: signText(title) });
  },
  handles(e: VillageEvent, state: ChapterHouseState, _ctx: SceneCtx) {
    return handlesChapter(e, state.instance);
  },
  mapEvent(e: VillageEvent, state: ChapterHouseState, ctx: SceneCtx): SceneCommand[] {
    return mapChapterEvent(e, state, ctx);
  },
  reduce(state, cmd, at) {
    return reduceBase(state, cmd, at);
  },
  paint(state, view, o) {
    return view === 'exterior' ? paintChapterExterior(state, o) : paintChapterInterior(state, o);
  },
  describe(state) {
    const name = `${state.title || chapterLabel(state.instance)} house`;
    if (state.access === 'locked') return `${name}, shuttered and quiet.`;
    if (state.access === 'dim') return `${name}, quiet for now.`;
    const expert =
      state.occupant === 'studying'
        ? 'expert is studying'
        : state.occupant === 'in_call'
          ? 'expert is in a call'
          : state.occupant === 'waiting'
            ? 'expert is waiting for you'
            : 'expert is resting';
    const g = state.glow;
    const mastery =
      g < 0.3
        ? 'mastery just beginning'
        : g < 0.7
          ? 'mastery growing'
          : g < 0.95
            ? 'mastery strong'
            : 'mastery glowing';
    return `${name}, ${expert}, ${mastery}.`;
  },
  onEnter(state, at) {
    return { ...state, enteredAt: at };
  },
  onExit(state) {
    return { ...state, enteredAt: null };
  },
};

const lockedDef: SceneDef<ChapterHouseState> = {
  ...chapterHouse,
  init: (opts) => ({ ...chapterHouse.init(opts), access: 'locked' }),
};

export const bundles: SceneBundle<ChapterHouseState>[] = shotBundles(chapterHouse, lockedDef);

/** The main bundle (open states, interiors); `bundles` adds the locked variant. */
export const chapterHouseBundle: SceneBundle<ChapterHouseState> = bundles[0]!;

export type { ShotDef };
