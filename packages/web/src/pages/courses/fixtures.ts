import { DEFAULT_LIMITS, deriveCourseStatus } from './model';
import type {
  CatalogueRow,
  ChapterRow,
  CourseDetail,
  FileRow,
  MasteryWord,
  PolicyLine,
  PolicyTopic,
} from './types';

export const SAMPLE_ID = 'c_openstax_stats';
export const SAMPLE_ATTRIBUTION = 'Introductory Statistics 2e, OpenStax, CC BY 4.0';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Mastery = ChapterRow['mastery'];
const m = (box: number): Mastery => ({
  box,
  word: (box <= 0 ? 'new' : box <= 2 ? 'learning' : box <= 4 ? 'steady' : 'strong') as MasteryWord,
});

function chapters(
  file: string,
  rows: [
    id: string,
    title: string,
    summary: string,
    start: number,
    end: number,
    box: number | null,
  ][],
): ChapterRow[] {
  return rows.map(([id, title, summary, pageStart, pageEnd, box]) => ({
    id,
    title,
    summary,
    file,
    pageStart,
    pageEnd,
    pageCount: pageEnd - pageStart + 1,
    mastery: box === null ? null : m(box),
  }));
}

function file(p: Partial<FileRow> & Pick<FileRow, 'fileId' | 'name'>, now: number): FileRow {
  return {
    kind: 'material',
    mime: 'application/pdf',
    size: 2_400_000,
    pages: 120,
    sha256: 'a41f09c3d7be',
    status: 'ready',
    pct: 100,
    uploadedAt: now - 3 * DAY,
    ...p,
  };
}

const policyLines = (rows: [text: string, topic: PolicyTopic][]): PolicyLine[] =>
  rows.map(([text, topic], i) => ({ n: 11 + i * 3, text, topic, verbatim: true }));

export function buildCourses(now = Date.now()): CourseDetail[] {
  const sampleFile = 'f_openstax_stats';
  const sample: CourseDetail = {
    id: SAMPLE_ID,
    title: 'Introductory Statistics',
    role: 'public',
    visibility: 'public',
    sample: true,
    attribution: SAMPLE_ATTRIBUTION,
    fileCount: 1,
    chapterCount: 13,
    pageCount: 396,
    status: 'ready',
    updatedAt: now - 30 * DAY,
    canEdit: false,
    policy: null,
    files: [
      file(
        {
          fileId: sampleFile,
          name: 'introductory-statistics-2e.pdf',
          size: 18_900_000,
          pages: 396,
          sha256: '7c2e91ab40d5',
          uploadedAt: now - 30 * DAY,
        },
        now,
      ),
    ],
    chapters: chapters(sampleFile, [
      ['st1', 'Sampling and data', 'Populations, samples and kinds of data.', 1, 24, 5],
      ['st2', 'Descriptive statistics', 'Centre, spread and the shape of a dataset.', 25, 58, 4],
      ['st3', 'Probability topics', 'Rules of probability, independence and trees.', 59, 92, 3],
      ['st4', 'Discrete random variables', 'Expected value, binomial and Poisson.', 93, 124, 2],
      [
        'st5',
        'Continuous random variables',
        'Density curves and the uniform and exponential.',
        125,
        150,
        1,
      ],
      ['st6', 'The normal distribution', 'Z-scores and the empirical rule.', 151, 176, 1],
      ['st7', 'The central limit theorem', 'Why sample means look normal.', 177, 202, 0],
      [
        'st8',
        'Confidence intervals',
        'Estimating a mean or proportion with a margin.',
        203,
        236,
        null,
      ],
      [
        'st9',
        'Hypothesis testing with one sample',
        'Null and alternative, p-values and errors.',
        237,
        270,
        null,
      ],
      [
        'st10',
        'Hypothesis testing with two samples',
        'Comparing means and proportions.',
        271,
        306,
        null,
      ],
      [
        'st11',
        'The chi-square distribution',
        'Goodness of fit and independence tests.',
        307,
        340,
        null,
      ],
      [
        'st12',
        'Linear regression and correlation',
        'Fitting a line and reading r.',
        341,
        372,
        null,
      ],
      [
        'st13',
        'F distribution and one-way ANOVA',
        'Comparing several means at once.',
        373,
        396,
        null,
      ],
    ]),
  };

  const bioNotes = 'f_bio_notes';
  const bio: CourseDetail = {
    id: 'c_bio201_9fK2pQ',
    title: 'BIO 201: Cell Biology',
    role: 'owner',
    visibility: 'private',
    sample: false,
    fileCount: 4,
    chapterCount: 6,
    pageCount: 212,
    status: 'ingesting',
    updatedAt: now - 2 * MIN,
    canEdit: true,
    files: [
      file(
        {
          fileId: bioNotes,
          name: 'bio201-lecture-notes.pdf',
          size: 6_800_000,
          pages: 212,
          sha256: 'e03b7719c2aa',
          uploadedAt: now - 5 * DAY,
        },
        now,
      ),
      file(
        {
          fileId: 'f_bio_slides',
          name: 'bio201-week4-slides.pdf',
          size: 11_200_000,
          pages: 64,
          sha256: '5d98f2b01e6c',
          status: 'embedding',
          pct: 42,
          uploadedAt: now - 1 * MIN,
        },
        now,
      ),
      file(
        {
          fileId: 'f_bio_lab',
          name: 'scanned-lab-manual.pdf',
          size: 22_600_000,
          pages: null,
          sha256: '0b6c44d9a8f1',
          status: 'failed',
          pct: 0,
          error: {
            code: 'no_text',
            message: 'No readable text found in this PDF.',
          },
          uploadedAt: now - 3 * MIN,
        },
        now,
      ),
      file(
        {
          fileId: 'f_bio_syllabus',
          name: 'bio201-syllabus.pdf',
          kind: 'syllabus',
          size: 240_000,
          pages: 4,
          sha256: 'c8a5e1190d3f',
          uploadedAt: now - 9 * DAY,
        },
        now,
      ),
    ],
    chapters: chapters(bioNotes, [
      ['b4', 'Chapter 4: Cell structure', 'Organelles, membranes and the cytoskeleton.', 1, 38, 5],
      [
        'b5',
        'Chapter 5: Cell energy',
        'Glycolysis, the Krebs cycle and the electron chain.',
        39,
        81,
        3,
      ],
      ['b6', 'Chapter 6: Photosynthesis', 'Light reactions and the Calvin cycle.', 82, 118, 2],
      [
        'b7',
        'Chapter 7: Cell communication',
        'Signalling, receptors and second messengers.',
        119,
        150,
        1,
      ],
      ['b8', 'Chapter 8: The cell cycle', 'Checkpoints, mitosis and what goes wrong.', 151, 183, 0],
      [
        'b9',
        'Chapter 9: Meiosis and inheritance',
        'Crossing over and independent assortment.',
        184,
        212,
        null,
      ],
    ]),
    policy: {
      sourceFile: 'bio201-syllabus.pdf',
      lines: policyLines([
        [
          'Homework is due by 11:59 pm on the Friday of the week it is assigned. Late work loses 10% per day, up to three days.',
          'homework',
        ],
        [
          'You may use AI tools to check your grammar or to explain a concept you are stuck on. You may not submit text, code or figures an AI tool produced as your own work.',
          'ai',
        ],
        [
          'Study groups are encouraged. Write up every problem set on your own, and name anyone you worked with at the top of the page.',
          'collaboration',
        ],
        [
          'Any suspected violation of the academic integrity policy is reported to the Dean of Students, whatever the size of the assignment.',
          'integrity',
        ],
        ['Lab notebooks are collected at the start of the lab session.', 'other'],
      ]),
    },
  };

  const hist: CourseDetail = {
    id: 'c_hist120_3Vq8Lm',
    title: 'HIST 120: World since 1500',
    role: 'owner',
    visibility: 'squad',
    sample: false,
    fileCount: 2,
    chapterCount: 4,
    pageCount: 188,
    status: 'ready',
    updatedAt: now - 4 * DAY,
    canEdit: true,
    policy: null,
    files: [
      file(
        {
          fileId: 'f_hist_reader',
          name: 'hist120-course-reader.pdf',
          size: 9_100_000,
          pages: 160,
          sha256: '91d0e47ab5c2',
          uploadedAt: now - 12 * DAY,
        },
        now,
      ),
      file(
        {
          fileId: 'f_hist_notes',
          name: 'week-1-to-4-notes.md',
          mime: 'text/markdown',
          size: 48_000,
          pages: 28,
          sha256: '2f7c8b55e0a3',
          uploadedAt: now - 11 * DAY,
        },
        now,
      ),
    ],
    chapters: chapters('f_hist_reader', [
      ['h1', 'The early modern world', 'Trade networks and the first global economy.', 1, 44, 4],
      ['h2', 'Empires and exchange', 'The Ottoman, Mughal and Spanish empires.', 45, 92, 2],
      ['h3', 'Revolutions', 'Atlantic revolutions and their legacies.', 93, 130, 1],
      ['h4', 'Industry and empire', 'Factories, railways and new empires.', 131, 160, null],
    ]),
  };

  const cs: CourseDetail = {
    id: 'c_cse310_Zx44Tt',
    title: 'CSE 310: Data Structures',
    role: 'squad',
    visibility: 'squad',
    sample: false,
    fileCount: 1,
    chapterCount: 5,
    pageCount: 244,
    status: 'ready',
    updatedAt: now - 1 * DAY,
    canEdit: false,
    policy: null,
    files: [
      file(
        {
          fileId: 'f_cs_text',
          name: 'cse310-lecture-slides.pdf',
          size: 14_300_000,
          pages: 244,
          sha256: 'bb10a6e93d72',
          uploadedAt: now - 20 * DAY,
        },
        now,
      ),
    ],
    chapters: chapters('f_cs_text', [
      ['c1', 'Arrays and linked lists', 'Contiguous storage against pointers.', 1, 40, 3],
      ['c2', 'Stacks and queues', 'Two ways to order work.', 41, 78, 2],
      ['c3', 'Trees and heaps', 'Binary trees, BSTs and priority queues.', 79, 140, 1],
      ['c4', 'Hash tables', 'Hash functions, collisions and load factor.', 141, 190, null],
      ['c5', 'Graphs', 'Traversal and shortest paths.', 191, 244, null],
    ]),
  };

  return [bio, sample, hist, cs].map((c) => ({ ...c, status: deriveCourseStatus(c.files) }));
}

export const SAMPLE_CATALOGUE: CatalogueRow[] = [
  {
    code: 'STAT 101',
    title: 'Introductory Statistics',
    credits: 3,
    days: 'TR',
    start: '13:00',
    end: '14:15',
    location: 'Online',
  },
  {
    code: 'BIO 201',
    title: 'Cell Biology',
    credits: 4,
    days: 'MWF',
    start: '09:00',
    end: '09:50',
    location: 'Science Hall 120',
  },
  {
    code: 'HIST 120',
    title: 'World since 1500',
    credits: 3,
    days: 'MW',
    start: '11:00',
    end: '12:15',
    location: 'Arts 204',
  },
  {
    code: 'CSE 310',
    title: 'Data Structures',
    credits: 4,
    days: 'TR',
    start: '10:30',
    end: '11:45',
    location: 'Engineering 3.1',
  },
];

export const MOCK_LIMITS = DEFAULT_LIMITS;
