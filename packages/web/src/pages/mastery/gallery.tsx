import type { GalleryStory } from '../../overlays/kit';
import { MasteryView, type MasteryViewProps } from './MasteryView';
import { masteryData, masteryEmpty, masteryNoCourse, masterySmall } from './fixtures';

const base: MasteryViewProps = { status: 'ready', connection: 'live', data: masteryData };
const S = (p: Partial<MasteryViewProps>) => <MasteryView {...base} {...p} />;

export const stories: GalleryStory[] = [
  { id: 'mastery-ready', title: 'Mastery: ready with squad average', render: () => S({}) },
  {
    id: 'mastery-small-squad',
    title: 'Mastery: squad of 2 (no averages)',
    render: () => S({ data: masterySmall }),
  },
  {
    id: 'mastery-not-started',
    title: 'Mastery: nothing started',
    render: () => S({ data: masteryEmpty }),
  },
  { id: 'mastery-empty', title: 'Mastery: no course', render: () => S({ data: masteryNoCourse }) },
  {
    id: 'mastery-loading',
    title: 'Mastery: loading',
    render: () => S({ status: 'loading', data: undefined, connection: 'connecting' }),
  },
  {
    id: 'mastery-error',
    title: 'Mastery: error',
    render: () => S({ status: 'error', data: undefined, connection: 'error', onRetry: () => {} }),
  },
  {
    id: 'mastery-offline',
    title: 'Mastery: offline',
    render: () =>
      S({ status: 'offline', data: undefined, connection: 'offline', onRetry: () => {} }),
  },
];
