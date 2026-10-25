import { readFileSync } from 'node:fs';
import { GOOGLE_SCOPES } from './types';
import {
  ConnectorAuthError,
  ConnectorExpiredError,
  type CanvasAuth,
  type CanvasConnector,
  type ConnectorCourse,
  type ConnectorItem,
  type ConnectorStatusInfo,
  type FetchedContent,
  type GoogleAuth,
  type GoogleConnector,
} from './types';
import { parseIcsEvents, splitCanvasSummary } from './ics';

const FIXTURES = new URL('../../../fixtures/connectors/', import.meta.url);
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
const readText = (name: string): string => readFileSync(new URL(name, FIXTURES), 'utf8');
const ms = (iso: string | undefined | null): number | null => (iso ? Date.parse(iso) : null);
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** What the fake upstream does to the credential. */
export type FakeBehavior = 'ok' | 'expired' | 'revoked' | 'unauthorized';

export interface FakeControls {
  /** Set the upstream behaviour for every credential, or only for the one whose secret is `key`. */
  set(behavior: FakeBehavior, key?: string): void;
  /** When true, `refresh()` fails (the expired token cannot be renewed). */
  refreshFails: boolean;
  /** Names of the connector methods called, in order (no secrets). */
  readonly calls: string[];
  /** Number of upstream revoke() calls. */
  revoked: number;
  /** Bump the fixture, e.g. to simulate an upstream edit or deletion between syncs. */
  mutate(fn: (data: unknown) => void): void;
}

function controls() {
  let global: FakeBehavior = 'ok';
  const per = new Map<string, FakeBehavior>();
  const pending: ((d: unknown) => void)[] = [];
  const c: FakeControls & {
    behaviorFor(key: string): FakeBehavior;
    drain(): ((d: unknown) => void)[];
  } = {
    set(b, key) {
      if (key) per.set(key, b);
      else {
        global = b;
        per.clear();
      }
    },
    refreshFails: false,
    calls: [],
    revoked: 0,
    mutate(fn) {
      pending.push(fn);
    },
    behaviorFor: (key) => per.get(key) ?? global,
    drain: () => pending.splice(0),
  };
  return c;
}

type Ctl = ReturnType<typeof controls>;

function guard(ctl: Ctl, key: string, method: string): void {
  ctl.calls.push(method);
  const b = ctl.behaviorFor(key);
  if (b === 'expired') throw new ConnectorExpiredError();
  if (b === 'revoked') throw new ConnectorAuthError(401, 'grant revoked upstream');
  if (b === 'unauthorized') throw new ConnectorAuthError(401);
}
function statusFor(ctl: Ctl, key: string): ConnectorStatusInfo {
  ctl.calls.push('status');
  switch (ctl.behaviorFor(key)) {
    case 'expired':
      return { state: 'expired', note: 'The access token expired and could not be renewed.' };
    case 'revoked':
      return { state: 'revoked', note: 'Access was revoked on the provider side.' };
    case 'unauthorized':
      return {
        state: 'error',
        degraded: true,
        note: 'The provider rejected the credential (401).',
      };
    default:
      return { state: 'live' };
  }
}

// ---------------------------------------------------------------- Canvas

interface CanvasFixture {
  account: { id: string };
  baseUrl: string;
  courses: { id: string; name: string; code: string }[];
  assignments: {
    id: string;
    courseId: string;
    name: string;
    dueAt: string;
    points: number;
    updatedAt: string;
    description: string;
  }[];
  announcements: {
    id: string;
    courseId: string;
    title: string;
    postedAt: string;
    message: string;
  }[];
  files: {
    id: string;
    courseId: string;
    name: string;
    updatedAt: string;
    pages: { page: number; text: string }[];
  }[];
}

const authKey = (a: CanvasAuth): string => (a.variant === 'feed' ? a.feedUrl : a.token);

export function createFakeCanvasConnector(): CanvasConnector & { controls: FakeControls } {
  const ctl = controls();
  const fx = readJson<CanvasFixture>('canvas.json');
  const ics = readText('canvas-feed.ics');
  const apply = () => {
    for (const fn of ctl.drain()) fn(fx);
  };
  const courseSlug = (id: string) => {
    const c = fx.courses.find((x) => x.id === id);
    return c ? slug(c.code) : id;
  };
  const feedItems = (): ConnectorItem[] =>
    parseIcsEvents(ics).map((e) => {
      const { title, code } = splitCanvasSummary(e.summary);
      return {
        externalId: `feed:${e.uid}`,
        kind: 'canvas_event' as const,
        title,
        courseId: code ? slug(code) : null,
        url: e.url,
        modifiedAt: null,
        startsAt: e.start,
        endsAt: e.end,
        dueAt: /assignment/.test(e.uid) ? e.start : null,
      };
    });
  const find = (item: ConnectorItem) => item.externalId;

  return {
    provider: 'canvas',
    mode: 'fixture',
    controls: ctl,
    async accountId() {
      return fx.account.id;
    },
    async listCourses(auth): Promise<ConnectorCourse[]> {
      guard(ctl, authKey(auth), 'listCourses');
      apply();
      if (auth.variant === 'feed') {
        const codes = new Map<string, string>();
        for (const i of feedItems())
          if (i.courseId) codes.set(i.courseId, i.courseId.toUpperCase().replace('-', ' '));
        return [...codes].map(([id, code]) => ({ id, name: code, code }));
      }
      return fx.courses.map((c) => ({ id: slug(c.code), name: c.name, code: c.code }));
    },
    async listItems(auth, courseId) {
      guard(ctl, authKey(auth), 'listItems');
      apply();
      let items: ConnectorItem[];
      if (auth.variant === 'feed') items = feedItems();
      else {
        items = [
          ...fx.assignments.map((a) => ({
            externalId: `assignment:${a.id}`,
            kind: 'canvas_assignment' as const,
            title: a.name,
            courseId: courseSlug(a.courseId),
            url: `${fx.baseUrl}/courses/${a.courseId}/assignments/${a.id}`,
            modifiedAt: ms(a.updatedAt),
            dueAt: ms(a.dueAt),
          })),
          ...fx.announcements.map((n) => ({
            externalId: `announcement:${n.id}`,
            kind: 'canvas_event' as const,
            title: n.title,
            courseId: courseSlug(n.courseId),
            url: `${fx.baseUrl}/courses/${n.courseId}/discussion_topics/${n.id}`,
            modifiedAt: ms(n.postedAt),
            startsAt: ms(n.postedAt),
          })),
          ...fx.files.map((f) => ({
            externalId: `file:${f.id}`,
            kind: 'canvas_file' as const,
            title: f.name,
            courseId: courseSlug(f.courseId),
            url: `${fx.baseUrl}/courses/${f.courseId}/files/${f.id}`,
            modifiedAt: ms(f.updatedAt),
          })),
        ];
      }
      return courseId ? items.filter((i) => i.courseId === courseId) : items;
    },
    async fetchContent(auth, item): Promise<FetchedContent> {
      guard(ctl, authKey(auth), 'fetchContent');
      const id = find(item);
      if (id.startsWith('feed:')) {
        const e = parseIcsEvents(ics).find((x) => `feed:${x.uid}` === id);
        return { text: e?.description ?? '' };
      }
      const [type, ext] = id.split(':') as [string, string];
      if (type === 'assignment') {
        const a = fx.assignments.find((x) => x.id === ext);
        if (!a) throw new Error('not_found');
        return { text: `Worth ${a.points} points.\n\n${a.description}` };
      }
      if (type === 'announcement')
        return { text: fx.announcements.find((x) => x.id === ext)?.message ?? '' };
      const f = fx.files.find((x) => x.id === ext);
      if (!f) throw new Error('not_found');
      return { pages: f.pages };
    },
    async revoke(auth) {
      ctl.calls.push('revoke');
      ctl.revoked += 1;
      ctl.set('revoked', authKey(auth));
    },
    async status(auth) {
      return statusFor(ctl, authKey(auth));
    },
  };
}

// ---------------------------------------------------------------- Google

interface GoogleFixture {
  account: { id: string };
  calendar: {
    id: string;
    summary: string;
    start: string;
    end: string;
    description: string;
    htmlLink: string;
  }[];
  drive: {
    id: string;
    kind: 'gdoc' | 'gdrive_file';
    name: string;
    modifiedAt: string;
    webViewLink: string;
    text: string;
  }[];
  classroom: {
    courses: { id: string; name: string }[];
    coursework: {
      id: string;
      courseId: string;
      title: string;
      dueAt: string;
      updatedAt: string;
      description: string;
      alternateLink: string;
    }[];
  };
}

export function createFakeGoogleConnector(): GoogleConnector & { controls: FakeControls } {
  const ctl = controls();
  const fx = readJson<GoogleFixture>('google.json');
  const apply = () => {
    for (const fn of ctl.drain()) fn(fx);
  };
  const key = (a: GoogleAuth) => a.refreshToken ?? a.accessToken;
  const has = (a: GoogleAuth, s: string) => a.scopes.includes(s);
  let seq = 0;

  return {
    provider: 'google',
    mode: 'fixture',
    controls: ctl,
    async accountId() {
      return fx.account.id;
    },
    async listCourses(a): Promise<ConnectorCourse[]> {
      guard(ctl, key(a), 'listCourses');
      if (!has(a, GOOGLE_SCOPES.classroomCourses)) return [];
      return fx.classroom.courses.map((c) => ({ id: `classroom-${c.id}`, name: c.name }));
    },
    async listItems(a, courseId) {
      guard(ctl, key(a), 'listItems');
      apply();
      const out: ConnectorItem[] = [];
      if (has(a, GOOGLE_SCOPES.calendar))
        for (const e of fx.calendar)
          out.push({
            externalId: `cal:${e.id}`,
            kind: 'gcal_event',
            title: e.summary,
            courseId: null,
            url: e.htmlLink,
            modifiedAt: null,
            startsAt: ms(e.start),
            endsAt: ms(e.end),
          });
      // drive.file is per-file: only what the user picked in the Picker is visible.
      if (has(a, GOOGLE_SCOPES.drive))
        for (const d of fx.drive)
          if (a.pickedFileIds?.includes(d.id))
            out.push({
              externalId: `drive:${d.id}`,
              kind: d.kind,
              title: d.name,
              courseId: null,
              url: d.webViewLink,
              modifiedAt: ms(d.modifiedAt),
            });
      if (has(a, GOOGLE_SCOPES.classroomWork))
        for (const w of fx.classroom.coursework)
          out.push({
            externalId: `classroom:${w.id}`,
            kind: 'classroom_item',
            title: w.title,
            courseId: `classroom-${w.courseId}`,
            url: w.alternateLink,
            modifiedAt: ms(w.updatedAt),
            dueAt: ms(w.dueAt),
          });
      return courseId ? out.filter((i) => i.courseId === courseId) : out;
    },
    async fetchContent(a, item): Promise<FetchedContent> {
      guard(ctl, key(a), 'fetchContent');
      const [type, id] = item.externalId.split(':') as [string, string];
      if (type === 'cal') return { text: fx.calendar.find((e) => e.id === id)?.description ?? '' };
      if (type === 'drive') {
        if (!a.pickedFileIds?.includes(id))
          throw new ConnectorAuthError(403, 'file not selected in the Picker');
        const d = fx.drive.find((x) => x.id === id);
        if (!d) throw new Error('not_found');
        return { text: d.text };
      }
      return { text: fx.classroom.coursework.find((w) => w.id === id)?.description ?? '' };
    },
    async revoke(a) {
      ctl.calls.push('revoke');
      ctl.revoked += 1;
      ctl.set('revoked', key(a));
    },
    async status(a) {
      return statusFor(ctl, key(a));
    },
    async refresh(a) {
      ctl.calls.push('refresh');
      if (ctl.refreshFails || !a.refreshToken)
        throw new ConnectorExpiredError('refresh token rejected');
      ctl.set('ok', key(a));
      seq += 1;
      return { accessToken: `fake-access-${seq}`, expiresAt: Date.now() + 3_600_000 };
    },
  };
}
