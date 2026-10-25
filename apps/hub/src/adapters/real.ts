// Real ports: brain (QuizEngine, Brain.ask, captions, mastery) and media (call + persona/voice ports).
// Imported only by main.ts and the live demo, never by createHub, so the hub's unit tests stay light.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAgentId, type Llm, type StudentId, type VillageEvent } from '@squad/core';
import {
  BrainUnavailableError,
  CaptionUnavailableError,
  chapterProviderFromStore,
  createBrain,
  createCouncilService,
  createMasteryStore,
  loadFixtureCourse,
  QuizEngine,
  type Brain,
  type KeyVerifier,
  type MasteryStore,
} from '@squad/brain';
import {
  createAudioServices,
  createCallPort,
  createMediaPort,
  MemoryVoiceStore,
  type AnswerFn,
  type AnswerSentence,
  type TtsEngine,
} from '@squad/media';
import { listPersonas } from '@squad/media/personas';
import { COURSE_ID } from '../cast';
import type {
  BrainPort,
  CourseStatus,
  MediaPort,
  Ports,
  QuizAnswerResult,
  QuizPayload,
  QuizPort,
} from '../ports';
import type { HubDeps } from '../types';

export interface RealPortsOptions {
  /** Gemini in the real hub, core's FakeLlm in tests and the live demo. */
  llm: Llm;
  /** Speech engine. ElevenLabs is built from env by `createAudioServices` when omitted and a key exists; otherwise calls are captions only. */
  tts?: TtsEngine;
  courseId?: string;
  /** council:quizkey verifier for generated questions (omit with FakeLlm). */
  verifier?: KeyVerifier;
  /** Load the committed OpenStax sample as course `demo` when it is missing (offline, default true). */
  loadFixture?: boolean;
}

export interface RealPorts {
  ports: Ports;
  brain: Brain;
  quiz: QuizEngine;
  mastery: MasteryStore;
  /** Open a quiz for these students (default: every member of the demo squad). Returns the quiz id. */
  startQuiz(chapter: string, students?: StudentId[]): Promise<string>;
}

type Round = {
  quizId: string;
  chapter: string;
  target: string | null;
  students_json: string;
  phase: string;
  idx: number;
};

const FALLBACK = 'I cannot reach the course materials right now. Try again in a moment.';

export async function createRealPorts(deps: HubDeps, o: RealPortsOptions): Promise<RealPorts> {
  const courseId = o.courseId ?? COURSE_ID;
  const { db } = deps;

  // In-process emit: events are validated and logged by the hub itself, no HTTP hop.
  const emit = (e: VillageEvent) => {
    deps.ingest.village(e);
  };
  // The hub mirrors agent captions onto the stream and routes quiz answers itself, so brain's copies are dropped.
  const brainEmit = (e: VillageEvent) => {
    if (e.t !== 'call.caption') emit(e);
  };
  const quizEmit = (e: VillageEvent) => {
    if (e.t !== 'quiz.answer' && e.t !== 'quiz.result') emit(e);
  };

  const brain = createBrain({ llm: o.llm, db, emit: brainEmit });
  if (o.loadFixture !== false && !brain.store.getCourse(courseId))
    await loadFixtureCourse({ store: brain.store }, courseId);

  deps.council = createCouncilService({
    llm: o.llm,
    db,
    emit,
    brain,
    courseId: () => courseId,
    demo: false,
  });

  const mastery = createMasteryStore({ db, emit: quizEmit });
  const engine = new QuizEngine({
    db,
    llm: o.llm,
    emit: quizEmit,
    mastery,
    chapters: chapterProviderFromStore(brain.store),
    ...(o.verifier ? { verifier: o.verifier } : {}),
  });

  const quiz = createRealQuizPort(deps, engine, courseId);
  const brainPort = createRealBrainPort(deps, brain, mastery, o.llm);
  const { media, call } = createAudioPorts(brain, courseId, o);

  return {
    ports: { quiz, call, brain: brainPort, media },
    brain,
    quiz: engine,
    mastery,
    startQuiz: async (chapter, students) =>
      engine.start(courseId, chapter, 'village', {
        students: students ?? deps.directory.students().map((s) => s.id),
      }),
  };
}

// ---------- quiz ----------

function createRealQuizPort(deps: HubDeps, engine: QuizEngine, courseId: string): QuizPort {
  const { db } = deps;
  const round = (quizId: string) =>
    db
      .prepare(
        'SELECT quizId, chapter, target, students_json, phase, idx FROM quiz_rounds WHERE quizId=?',
      )
      .get(quizId) as Round | undefined;
  const answered = (quizId: string, idx: number, student: string) =>
    db
      .prepare(
        'SELECT 1 AS x FROM quiz_answers WHERE quizId=? AND idx=? AND student=? AND correct IS NOT NULL',
      )
      .get(quizId, idx, student) !== undefined;
  const visible = (r: Round, viewer: string) => {
    const students = JSON.parse(r.students_json) as string[];
    return (
      (students.length === 0 || students.includes(viewer)) && (!r.target || r.target === viewer)
    );
  };

  return {
    async get(quizId, viewer): Promise<QuizPayload | null> {
      const r = round(quizId);
      if (!r || r.phase !== 'collecting' || !visible(r, viewer)) return null;
      const p = engine.payload(quizId);
      return {
        quizId: p.quizId,
        chapter: p.chapter,
        question: p.question,
        ...(p.choices ? { choices: p.choices.map((text, i) => ({ id: String(i), text })) } : {}),
      };
    },
    async answer(quizId, viewer, a): Promise<QuizAnswerResult | null> {
      const r = round(quizId);
      if (!r || r.phase !== 'collecting' || !visible(r, viewer)) return null;
      if (answered(quizId, r.idx, viewer)) return { recorded: true, chapter: r.chapter };
      const body =
        a.choice !== undefined
          ? /^\d+$/.test(a.choice)
            ? { choice: Number(a.choice) }
            : null
          : a.text !== undefined
            ? { text: a.text }
            : null;
      if (!body) return null;
      try {
        const res = await engine.answer(quizId, viewer, body);
        if (!res.graded) return { recorded: false, chapter: r.chapter };
        // `feedback` is private to the answering student; the hub only reveals it when the squad allows.
        return {
          recorded: true,
          correct: res.correct,
          explanation: res.feedback,
          chapter: r.chapter,
        };
      } catch (e) {
        deps.log.warn('quiz answer rejected', { quizId, err: (e as Error).name });
        return null;
      }
    },
    async listOpen(viewer) {
      void courseId;
      const rows = db
        .prepare(
          "SELECT quizId, chapter, target, students_json, phase, idx FROM quiz_rounds WHERE phase='collecting' ORDER BY createdAt",
        )
        .all() as Round[];
      return rows
        .filter((r) => visible(r, viewer) && !answered(r.quizId, r.idx, viewer))
        .map((r) => ({
          quizId: r.quizId,
          chapter: r.chapter,
          ...(r.target ? { target: r.target } : {}),
        }));
    },
    start: async ({ chapter, students }) =>
      engine.start(courseId, chapter, 'village', {
        students: students ?? deps.directory.students().map((s) => s.id),
      }),
  };
}

// ---------- brain port ----------

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'course';

function createRealBrainPort(
  deps: HubDeps,
  brain: Brain,
  mastery: MasteryStore,
  _llm: Llm,
): BrainPort {
  const progress = new Map<string, CourseStatus>(); // in-flight or failed uploads, by courseId

  return {
    async ingestCourse(student, file) {
      const courseId = slug(file.name);
      progress.set(courseId, {
        courseId,
        title: file.name,
        file: file.name,
        status: 'parsing',
        pct: 10,
      });
      const note = (status: CourseStatus['status'], pct?: number) =>
        deps.ingest.x('x.ingest.progress', {
          student,
          courseId,
          file: file.name,
          status,
          ...(pct !== undefined ? { pct } : {}),
        });
      // Ingest in the background; the route answers 202 right away and the stream carries progress.
      void (async () => {
        const dir = mkdtempSync(join(tmpdir(), 'squad-ingest-'));
        try {
          const path = join(dir, `${courseId}.pdf`);
          writeFileSync(path, file.bytes);
          note('parsing', 10);
          await brain.ingestPdf(courseId, path, { title: file.name });
          progress.delete(courseId);
          note('ready', 100);
        } catch (e) {
          progress.set(courseId, {
            courseId,
            title: file.name,
            file: file.name,
            status: 'failed',
          });
          deps.log.warn('course ingest failed', { courseId, err: (e as Error).name });
          note('failed');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      })();
      return { courseId };
    },

    async listCourses() {
      const rows = deps.db.prepare('SELECT id, title FROM courses ORDER BY rowid').all() as {
        id: string;
        title: string;
      }[];
      const ready = rows
        .filter((r) => !progress.has(r.id))
        .map((r): CourseStatus => ({
          courseId: r.id,
          title: r.title,
          file: brain.store.listChapters(r.id)[0]?.file ?? r.title,
          status: 'ready',
          pct: 100,
        }));
      return [...ready, ...progress.values()];
    },

    async mastery(student, courseId) {
      const chapters = brain.store.listChapters(courseId).map((c) => c.id);
      const score = (s: StudentId) => {
        const rows = new Map(mastery.forStudent(s, courseId).map((r) => [r.chapter, r.box]));
        return chapters.map((c) => (rows.has(c) ? (rows.get(c) ?? 0) / 5 : 0));
      };
      const squadId = deps.directory.squadOf(student);
      const members = squadId ? (deps.directory.squad(squadId)?.members ?? []) : [];
      return { concepts: chapters, mine: score(student), squad: members.map(score) };
    },

    // Calendar import is not wired to a mesh agent yet: only the count of blocks is returned and nothing is stored.
    async loadCalendar(_student, input) {
      if (input.demo) return { busyBlocks: 12 };
      return { busyBlocks: (input.ics?.match(/BEGIN:VEVENT/g) ?? []).length };
    },
  };
}

// ---------- media (call + personas + voices) ----------

function createAudioPorts(
  brain: Brain,
  defaultCourse: string,
  o: RealPortsOptions,
): { media: MediaPort; call: Ports['call'] } {
  let n = 0;
  const answer: AnswerFn = async ({ agent, student, text }) => {
    const a = parseAgentId(agent);
    try {
      if (a.kind === 'expert') {
        const lines = await brain.captions.run({
          callId: `call_${student}_${++n}`,
          courseId: defaultCourse,
          chapter: a.ref ?? '',
          question: text,
          student,
        });
        return lines.map((l): AnswerSentence => ({
          text: l.text,
          ...(l.cite ? { cite: l.cite } : {}),
        }));
      }
      const r = await brain.ask(defaultCourse, text);
      return [{ text: r.text, ...(r.citations[0] ? { cite: r.citations[0] } : {}) }];
    } catch (e) {
      if (e instanceof BrainUnavailableError || e instanceof CaptionUnavailableError)
        return [{ text: FALLBACK }];
      throw e;
    }
  };
  const knownAgent = (agent: string) =>
    ['expert', 'dean', 'council'].includes(parseAgentId(agent).kind);

  const audio = o.tts || process.env.ELEVENLABS_API_KEY ? tryAudio(o) : undefined;
  if (audio)
    return {
      media: audio.mediaPort(() => listPersonas()),
      call: audio.callPort({ answer, knownAgent }),
    };

  // No speech engine: captions only (a failing TTS yields text-only turns), previews unavailable.
  const noTts = {
    speak: async () => {
      throw new Error('tts unavailable');
    },
  };
  const store = new MemoryVoiceStore();
  return {
    media: createMediaPort({
      personas: () => listPersonas(),
      tts: { speakVoice: async () => Promise.reject(new Error('tts unavailable')) },
      store,
    }),
    call: createCallPort({ tts: noTts, answer, knownAgent }),
  };
}

function tryAudio(o: RealPortsOptions) {
  try {
    return createAudioServices(o.tts ? { engine: o.tts } : {});
  } catch {
    return undefined;
  }
}
