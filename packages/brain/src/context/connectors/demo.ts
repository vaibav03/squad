// DEMO WORKSPACES: original, synthetic Canvas and Google content generated RELATIVE TO TODAY. Offered when the Canvas
// extension is absent / no Google OAuth client is configured. Always mode `fixture` (provenance `*:fixture`), so every
// surface labels it "Demo data" and never "Live". No real course, student, institution or account.
import { GOOGLE_SCOPES } from './types';
import type {
  CanvasAuth,
  CanvasConnector,
  ConnectorCourse,
  ConnectorItem,
  FetchedContent,
  GoogleAuth,
  GoogleConnector,
} from './types';

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Midnight UTC of the day `now` falls on: ids and dates stay stable within a day. */
const day0 = (now: number) => Math.floor(now / DAY) * DAY;

interface DemoCourse {
  id: string;
  code: string;
  name: string;
  modules: { id: string; title: string; items: string[] }[];
  pages: { id: string; module: string; title: string; pages: { page: number; text: string }[] }[];
  files: { id: string; name: string; pages: { page: number; text: string }[] }[];
  assignments: { id: string; name: string; dueInDays: number; points: number; text: string }[];
  announcements: { id: string; title: string; agoDays: number; text: string }[];
  events: { id: string; title: string; inDays: number; hour: number; text: string }[];
}

const COURSES: DemoCourse[] = [
  {
    id: 'data101',
    code: 'DATA 101',
    name: 'Introduction to Data Analysis',
    modules: [
      { id: 'm1', title: 'Module 1: Describing data', items: ['Lecture page: Centre and spread', 'Slides: Week 1 summary statistics', 'Assignment 1: Describe a dataset'] },
      { id: 'm2', title: 'Module 2: Uncertainty', items: ['Lecture page: Sampling and error', 'Assignment 2: Sampling experiment'] },
    ],
    pages: [
      {
        id: 'p1', module: 'm1', title: 'Lecture page: Centre and spread',
        pages: [
          { page: 1, text: 'Centre and spread\nThe mean is the balance point of a dataset; the median is the middle value once the data are sorted. The median resists outliers, the mean does not.' },
          { page: 2, text: 'Measuring spread\nThe standard deviation measures the typical distance of values from the mean. The interquartile range, the distance between the 25th and 75th percentiles, ignores the extremes.' },
        ],
      },
      {
        id: 'p2', module: 'm2', title: 'Lecture page: Sampling and error',
        pages: [
          { page: 1, text: 'Sampling and error\nA sample is a small group drawn from a population. A statistic computed from a sample varies from sample to sample; that variation is called sampling error.' },
          { page: 2, text: 'Standard error\nThe standard error of the mean equals the standard deviation divided by the square root of the sample size, so larger samples give steadier estimates.' },
        ],
      },
    ],
    files: [
      {
        id: 'f1', name: 'Week 1 slides: summary statistics.pdf',
        pages: [
          { page: 1, text: 'Week 1: summary statistics\nToday: mean, median, mode, range.' },
          { page: 2, text: 'When to prefer the median\nUse the median for skewed data such as incomes or house prices, where a few huge values pull the mean upward.' },
          { page: 3, text: 'Reading a box plot\nThe box spans the interquartile range, the line inside is the median, and the whiskers reach the most extreme non-outlier values.' },
        ],
      },
    ],
    assignments: [
      { id: 'a1', name: 'Assignment 1: Describe a dataset', dueInDays: 3, points: 20, text: 'Pick one of the three class datasets. Report the mean, median and standard deviation, and say in two sentences which centre you would quote and why.' },
      { id: 'a2', name: 'Assignment 2: Sampling experiment', dueInDays: 10, points: 30, text: 'Draw 200 random samples of size 25 and plot how the sample means vary. Explain what happens to the spread when the sample size is quadrupled.' },
    ],
    announcements: [{ id: 'n1', title: 'Office hours moved to Thursday', agoDays: 1, text: 'This week office hours move to Thursday 15:00 in the study lounge. Bring questions about Assignment 1.' }],
    events: [{ id: 'e1', title: 'DATA 101 quiz 1', inDays: 6, hour: 10, text: 'Quiz 1 covers module 1: centre and spread.' }],
  },
  {
    id: 'bio120',
    code: 'BIO 120',
    name: 'Cell Biology Foundations',
    modules: [
      { id: 'm1', title: 'Module 1: Membranes', items: ['Lecture page: Membrane transport', 'Slides: Week 2 diffusion and osmosis'] },
      { id: 'm2', title: 'Module 2: Energy', items: ['Lecture page: Cellular respiration', 'Lab report 1: Osmosis'] },
    ],
    pages: [
      {
        id: 'p1', module: 'm1', title: 'Lecture page: Membrane transport',
        pages: [
          { page: 1, text: 'Membrane transport\nThe phospholipid bilayer lets small nonpolar molecules cross freely, while ions and large polar molecules need channel or carrier proteins.' },
          { page: 2, text: 'Osmosis\nOsmosis is the diffusion of water across a selectively permeable membrane from low solute concentration to high solute concentration.' },
        ],
      },
      {
        id: 'p2', module: 'm2', title: 'Lecture page: Cellular respiration',
        pages: [
          { page: 1, text: 'Cellular respiration\nGlycolysis splits one glucose into two pyruvate in the cytoplasm and yields a net of two ATP.' },
          { page: 2, text: 'The mitochondrion\nThe citric acid cycle and the electron transport chain run in the mitochondrion and produce most of the ATP, about 30 per glucose.' },
        ],
      },
    ],
    files: [
      {
        id: 'f1', name: 'Week 2 slides: diffusion and osmosis.pdf',
        pages: [
          { page: 1, text: 'Week 2: diffusion and osmosis\nPassive transport needs no cellular energy.' },
          { page: 2, text: 'Tonicity\nIn a hypotonic solution a cell gains water and may burst; in a hypertonic solution it loses water and shrinks.' },
        ],
      },
    ],
    assignments: [
      { id: 'a1', name: 'Lab report 1: Osmosis in potato cores', dueInDays: 5, points: 25, text: 'Record the mass change of potato cores in five salt solutions and state the concentration at which there is no net change.' },
      { id: 'a2', name: 'Problem set: Energy and ATP', dueInDays: 12, points: 15, text: 'Trace one glucose through glycolysis and respiration and tabulate the ATP produced at each stage.' },
    ],
    announcements: [{ id: 'n1', title: 'Lab safety reminder', agoDays: 2, text: 'Closed-toe shoes and goggles are required for the osmosis lab on Wednesday.' }],
    events: [{ id: 'e1', title: 'BIO 120 lab practical', inDays: 8, hour: 14, text: 'Practical on membranes and microscopy.' }],
  },
  {
    id: 'hist140',
    code: 'HIST 140',
    name: 'Trade and Empire in World History',
    modules: [
      { id: 'm1', title: 'Module 1: Overland routes', items: ['Lecture page: The caravan economy', 'Reading response 1'] },
      { id: 'm2', title: 'Module 2: Maritime networks', items: ['Lecture page: Monsoon trade', 'Slides: Week 3 ports and power'] },
    ],
    pages: [
      {
        id: 'p1', module: 'm1', title: 'Lecture page: The caravan economy',
        pages: [
          { page: 1, text: 'The caravan economy\nOverland trade moved high-value, low-weight goods such as silk and spices; oasis towns grew rich by taxing and sheltering caravans.' },
          { page: 2, text: 'Why routes shifted\nShifts in political stability, not geography alone, decided whether merchants used the northern or the southern route.' },
        ],
      },
      {
        id: 'p2', module: 'm2', title: 'Lecture page: Monsoon trade',
        pages: [
          { page: 1, text: 'Monsoon trade\nSeasonal winds let ships cross the Indian Ocean on a predictable schedule: east in summer, west in winter.' },
          { page: 2, text: 'Ports and power\nPort cities gained power by offering warehouses, credit and neutral courts to foreign merchants.' },
        ],
      },
    ],
    files: [
      {
        id: 'f1', name: 'Week 3 slides: ports and power.pdf',
        pages: [
          { page: 1, text: 'Week 3: ports and power\nHow harbour cities turned geography into political influence.' },
          { page: 2, text: 'Case: a monsoon entrepot\nMerchants waited months for the winds to turn, so ports built markets, lodging and legal systems to serve them.' },
        ],
      },
    ],
    assignments: [
      { id: 'a1', name: 'Reading response 1: Caravan towns', dueInDays: 4, points: 10, text: 'In 400 words, explain why oasis towns became wealthy without producing the goods they traded.' },
      { id: 'a2', name: 'Essay proposal: A trading port', dueInDays: 14, points: 20, text: 'Propose a port city for your final essay and list three primary or secondary sources.' },
    ],
    announcements: [{ id: 'n1', title: 'Reading for Friday posted', agoDays: 0, text: 'The Friday reading on monsoon ports is posted in Module 2.' }],
    events: [{ id: 'e1', title: 'HIST 140 discussion section', inDays: 2, hour: 13, text: 'Bring your reading response notes.' }],
  },
];

const courseOf = (id: string) => COURSES.find((c) => c.id === id)!;

function canvasItems(now: number): ConnectorItem[] {
  const base = day0(now);
  const out: ConnectorItem[] = [];
  for (const c of COURSES) {
    const url = (p: string) => `https://canvas.demo.invalid/courses/${c.id}/${p}`;
    for (const m of c.modules)
      out.push({ externalId: `module:${c.id}-${m.id}`, kind: 'canvas_file', title: m.title, courseId: c.id, url: url(`modules#${m.id}`), modifiedAt: base - 7 * DAY });
    for (const p of c.pages)
      out.push({ externalId: `page:${c.id}-${p.id}`, kind: 'canvas_file', title: p.title, courseId: c.id, url: url(`pages/${p.id}`), modifiedAt: base - 5 * DAY });
    for (const f of c.files)
      out.push({ externalId: `file:${c.id}-${f.id}`, kind: 'canvas_file', title: f.name, courseId: c.id, url: url(`files/${f.id}`), modifiedAt: base - 6 * DAY });
    for (const a of c.assignments)
      out.push({ externalId: `assignment:${c.id}-${a.id}`, kind: 'canvas_assignment', title: a.name, courseId: c.id, url: url(`assignments/${a.id}`), modifiedAt: base - 4 * DAY, dueAt: base + a.dueInDays * DAY + 23 * HOUR + 59 * 60_000 });
    for (const n of c.announcements)
      out.push({ externalId: `announcement:${c.id}-${n.id}`, kind: 'canvas_event', title: n.title, courseId: c.id, url: url(`discussion_topics/${n.id}`), modifiedAt: base - n.agoDays * DAY, startsAt: base - n.agoDays * DAY + 9 * HOUR });
    for (const e of c.events)
      out.push({ externalId: `event:${c.id}-${e.id}`, kind: 'canvas_event', title: e.title, courseId: c.id, url: url(`calendar_events/${e.id}`), modifiedAt: base - DAY, startsAt: base + e.inDays * DAY + e.hour * HOUR, endsAt: base + e.inDays * DAY + (e.hour + 1) * HOUR });
  }
  return out;
}

function canvasContent(item: ConnectorItem): FetchedContent {
  const [type, rest = ''] = item.externalId.split(':') as [string, string];
  const [cid, key = ''] = [rest.slice(0, rest.lastIndexOf('-')), rest.slice(rest.lastIndexOf('-') + 1)];
  const c = courseOf(cid);
  if (!c) throw new Error('not_found');
  if (type === 'module') {
    const m = c.modules.find((x) => x.id === key)!;
    return { text: `Course: ${c.name} (${c.code})\n${m.title}\nItems:\n${m.items.map((i) => `- ${i}`).join('\n')}` };
  }
  if (type === 'page') {
    const p = c.pages.find((x) => x.id === key)!;
    const mod = c.modules.find((x) => x.id === p.module)!;
    return { pages: p.pages.map((pg) => ({ page: pg.page, text: `${c.name}, ${mod.title}\n${pg.text}` })) };
  }
  if (type === 'file') return { pages: c.files.find((x) => x.id === key)!.pages };
  if (type === 'assignment') {
    const a = c.assignments.find((x) => x.id === key)!;
    return { text: `Worth ${a.points} points.\n\n${a.text}` };
  }
  if (type === 'announcement') return { text: c.announcements.find((x) => x.id === key)!.text };
  return { text: c.events.find((x) => x.id === key)?.text ?? '' };
}

export function createDemoCanvasConnector(now: () => number = Date.now): CanvasConnector {
  return {
    provider: 'canvas',
    mode: 'fixture',
    async accountId(_a: CanvasAuth) {
      return 'demo-canvas-workspace';
    },
    async listCourses(): Promise<ConnectorCourse[]> {
      return COURSES.map((c) => ({ id: c.id, name: c.name, code: c.code }));
    },
    async listItems(_a, courseId) {
      const items = canvasItems(now());
      return courseId ? items.filter((i) => i.courseId === courseId) : items;
    },
    async fetchContent(_a, item) {
      return canvasContent(item);
    },
    async revoke() {},
    async status() {
      return { state: 'live' };
    },
  };
}

// ---------------------------------------------------------------- Google demo

const CLASSES: { id: string; title: string; dow: number; hour: number; room: string; note: string }[] = [
  { id: 'data', title: 'DATA 101 lecture', dow: 1, hour: 10, room: 'Hall B', note: 'Lecture on centre, spread and sampling.' },
  { id: 'bio', title: 'BIO 120 lecture', dow: 2, hour: 9, room: 'Science 204', note: 'Lecture on membranes and energy.' },
  { id: 'hist', title: 'HIST 140 seminar', dow: 3, hour: 13, room: 'Arts 12', note: 'Seminar on trade routes.' },
  { id: 'bio-lab', title: 'BIO 120 lab', dow: 4, hour: 14, room: 'Lab 3', note: 'Osmosis lab session.' },
  { id: 'study', title: 'Study group: DATA 101', dow: 0, hour: 18, room: 'Library annex', note: 'Work through the sampling experiment together.' },
  { id: 'gym', title: 'Climbing wall', dow: 5, hour: 17, room: 'Rec centre', note: 'Weekly session.' },
];

const DRIVE = [
  {
    id: 'demo-notes-data',
    kind: 'gdoc' as const,
    name: 'DATA 101: my lecture notes',
    text: '# Centre and spread\n\nMean is the balance point; median is the middle value.\n\n# Sampling error\n\nStatistics vary from sample to sample. Bigger samples give a smaller standard error.',
  },
  {
    id: 'demo-notes-bio',
    kind: 'gdoc' as const,
    name: 'BIO 120: osmosis lab plan',
    text: '# Osmosis lab plan\n\nCut 15 potato cores, weigh each, soak in five salt solutions, reweigh after 40 minutes.\n\n# Expected result\n\nCores in weak solutions gain mass; cores in strong solutions lose mass.',
  },
];

const COURSEWORK = [
  { id: 'cw1', courseId: 'econ105', title: 'Problem set 3: Supply and demand', dueInDays: 4, text: 'Draw the supply and demand curves for the market described and mark the new equilibrium after a price ceiling.' },
  { id: 'cw2', courseId: 'econ105', title: 'Short essay: Opportunity cost', dueInDays: 11, text: 'In 300 words, explain opportunity cost using an example from your own week.' },
];

export function createDemoGoogleConnector(now: () => number = Date.now): GoogleConnector {
  const has = (a: GoogleAuth, s: string) => a.scopes.includes(s);
  return {
    provider: 'google',
    mode: 'fixture',
    async accountId() {
      return 'demo-google-workspace@example.invalid';
    },
    async listCourses(a) {
      return has(a, GOOGLE_SCOPES.classroomCourses) ? [{ id: 'classroom-econ105', name: 'Principles of Economics' }] : [];
    },
    async listItems(a, courseId) {
      const base = day0(now());
      const out: ConnectorItem[] = [];
      if (has(a, GOOGLE_SCOPES.calendar))
        for (let d = 0; d < 7; d++) {
          const date = new Date(base + d * DAY);
          for (const c of CLASSES)
            if (c.dow === date.getUTCDay())
              out.push({
                externalId: `cal:${c.id}-${date.toISOString().slice(0, 10)}`,
                kind: 'gcal_event',
                title: c.title,
                courseId: null,
                url: `https://calendar.demo.invalid/event/${c.id}`,
                modifiedAt: null,
                startsAt: base + d * DAY + c.hour * HOUR,
                endsAt: base + d * DAY + (c.hour + 1) * HOUR + (c.id === 'bio-lab' ? HOUR : 0),
              });
        }
      if (has(a, GOOGLE_SCOPES.drive))
        for (const dd of DRIVE)
          out.push({
            externalId: `drive:${dd.id}`,
            kind: dd.kind,
            title: dd.name,
            courseId: null,
            url: `https://docs.demo.invalid/document/d/${dd.id}`,
            modifiedAt: base - 2 * DAY,
          });
      if (has(a, GOOGLE_SCOPES.classroomWork))
        for (const w of COURSEWORK)
          out.push({
            externalId: `classroom:${w.id}`,
            kind: 'classroom_item',
            title: w.title,
            courseId: `classroom-${w.courseId}`,
            url: `https://classroom.demo.invalid/c/${w.courseId}/a/${w.id}`,
            modifiedAt: base - 3 * DAY,
            dueAt: base + w.dueInDays * DAY + 23 * HOUR + 59 * 60_000,
          });
      return courseId ? out.filter((i) => i.courseId === courseId) : out;
    },
    async fetchContent(_a, item): Promise<FetchedContent> {
      const [type, id = ''] = item.externalId.split(':') as [string, string];
      if (type === 'cal') {
        const c = CLASSES.find((x) => id.startsWith(`${x.id}-`));
        return { text: c ? `${c.note}\nLocation: ${c.room}` : '' };
      }
      if (type === 'drive') return { text: DRIVE.find((x) => x.id === id)?.text ?? '' };
      return { text: COURSEWORK.find((w) => w.id === id)?.text ?? '' };
    },
    async revoke() {},
    async status() {
      return { state: 'live' };
    },
    async refresh() {
      return { accessToken: `demo-access-${now()}`, expiresAt: now() + HOUR };
    },
  };
}
