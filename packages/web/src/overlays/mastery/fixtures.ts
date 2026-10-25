import type { MasteryData } from './model';

/** Default course the panel asks the hub about: the demo hub seeds `cse310`. */
export const COURSE_ID = 'cse310';
const c = (id: string, label: string, box: number, squadAvg?: number) => ({
  id,
  label,
  box,
  ...(squadAvg !== undefined ? { squadAvg } : {}),
});

export const masteryData: MasteryData = {
  courseId: COURSE_ID,
  courseTitle: 'BIO 201: Cell Biology',
  memberCount: 4,
  chapters: [
    {
      id: 'ch4',
      title: 'Chapter 4: Cell structure',
      concepts: [
        c('organelles', 'Organelles and their jobs', 5, 4),
        c('membranes', 'Membrane transport', 4, 3),
        c('cytoskeleton', 'The cytoskeleton', 3, 3),
      ],
    },
    {
      id: 'ch5',
      title: 'Chapter 5: Cell energy',
      concepts: [
        c('glycolysis', 'Glycolysis', 4, 3),
        c('krebs', 'The citric acid cycle', 2, 2),
        c('etc', 'Electron transport chain', 1, 2),
        c('atp', 'ATP synthase', 0, 1),
      ],
    },
    {
      id: 'ch6',
      title: 'Chapter 6: Photosynthesis',
      concepts: [c('light', 'Light reactions', 2, 3), c('calvin', 'The Calvin cycle', 0, 2)],
    },
    {
      id: 'ch7',
      title: 'Chapter 7: Cell division',
      concepts: [
        c('mitosis', 'Phases of mitosis', 3, 3),
        c('cycle', 'Cell cycle checkpoints', 0, 1),
      ],
    },
  ],
};

export const masterySmall: MasteryData = {
  ...masteryData,
  memberCount: 2,
  chapters: masteryData.chapters.map((ch) => ({
    ...ch,
    concepts: ch.concepts.map(({ squadAvg: _s, ...r }) => r),
  })),
};
export const masteryEmpty: MasteryData = {
  ...masteryData,
  chapters: masteryData.chapters.map((ch) => ({
    ...ch,
    concepts: ch.concepts.map((x) => ({ ...x, box: 0 })),
  })),
};
export const masteryNoCourse: MasteryData = { ...masteryData, chapters: [] };
