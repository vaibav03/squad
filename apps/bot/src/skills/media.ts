import { join } from 'node:path';
import type { InboundMessage, OutboundMessage, Skill, StudentId } from '@squad/core';
import { MIN_GROUP_SIZE } from '@squad/core';
import type { CourseStore, MasteryStore } from '@squad/brain';
import {
  makeExplainer,
  makePodcast,
  type ExplainerDeps,
  type ExplainerMaterialProvider,
  type MaterialProvider,
  type PodcastDeps,
} from '@squad/media';

const MAX_PASSAGES = 6;
const WEAK_BOX = 2;

export const MEDIA_UNAVAILABLE = "I couldn't make that just now. Try again in a minute.";
export const NO_CHAPTER = "I don't have course materials for that yet.";

/** "ch3" / "chapter 3" anywhere in the text, else the first chapter in the course. */
export function pickChapter(text: string, chapters: { id: string }[]): string | undefined {
  const n = /\bch(?:apter)?\.?\s*(\d+)\b/i.exec(text);
  if (n) {
    const id = `ch${n[1]}`;
    if (chapters.some((c) => c.id === id)) return id;
  }
  return chapters[0]?.id;
}

function passagesFor(store: CourseStore, courseId: string, chapter: string) {
  return store
    .getPages(courseId, chapter)
    .slice(0, MAX_PASSAGES)
    .map((p) => ({
      id: `${p.file}#${p.page}`,
      text: p.text.slice(0, 900),
      cite: { courseId, chapter, file: p.file, page: p.page },
    }));
}

/**
 * Podcast material straight from the brain's stores. Squad-level weak spots are anonymised counts
 * (how many members are in box <= 2 per chapter) and only emitted for squads of 3 or more; the
 * personal cut carries the asker's own weak chapters and nothing else. No names ever.
 */
export function podcastMaterial(
  store: CourseStore,
  mastery: MasteryStore,
  members: (chatId: string) => StudentId[],
): MaterialProvider {
  return async (req) => {
    const chapter = store.getChapter(req.courseId, req.chapter);
    if (!chapter) throw new Error(`unknown chapter ${req.chapter}`);
    const squad = members(req.chatId);
    const squadSize = Math.max(squad.length, req.audience === 'squad' ? 0 : 1);
    const title = (id: string) => store.getChapter(req.courseId, id)?.title ?? id;
    const weakSpots =
      req.audience === 'squad' && squadSize >= MIN_GROUP_SIZE
        ? store
            .listChapters(req.courseId)
            .map((c) => ({
              concept: c.title,
              count: squad.filter(
                (s) => mastery.get(s, req.courseId, c.id).box <= WEAK_BOX && hasRow(store, s, c.id),
              ).length,
            }))
            .filter((w) => w.count > 0)
        : undefined;
    const personalWeakSpots =
      req.audience === 'squad'
        ? undefined
        : mastery
            .forStudent(req.audience, req.courseId)
            .filter((r) => r.box <= WEAK_BOX)
            .map((r) => title(r.chapter));
    return {
      chapterTitle: chapter.title,
      passages: passagesFor(store, req.courseId, req.chapter),
      ...(weakSpots ? { weakSpots } : {}),
      ...(personalWeakSpots ? { personalWeakSpots } : {}),
      squadSize,
    };
  };
}

function hasRow(store: CourseStore, student: StudentId, chapter: string): boolean {
  return !!store.db
    .prepare('SELECT 1 FROM mastery WHERE student=? AND chapter=?')
    .get(student, chapter);
}

export function explainerMaterial(store: CourseStore): ExplainerMaterialProvider {
  return async (req) => {
    const chapter = store.getChapter(req.courseId, req.chapter);
    if (!chapter) throw new Error(`unknown chapter ${req.chapter}`);
    return {
      chapterTitle: chapter.title,
      passages: passagesFor(store, req.courseId, req.chapter),
    };
  };
}

export interface MediaSkillDeps {
  store: CourseStore;
  podcast: Omit<PodcastDeps, 'material' | 'outDir'>;
  explainer: Omit<ExplainerDeps, 'material' | 'outDir'>;
  mastery: MasteryStore;
  outDir: string;
  courseId?: (m: InboundMessage) => string;
}

const PODCAST_RE = /\b(podcast|recap\s+radio)\b/i;
const EXPLAINER_RE = /\b(picture\s+it|explainer|diagram|infographic)\b/i;
const PERSONAL_RE = /\b(my|me|personal|for me)\b/i;

/** Podcast and explainer skills. Both score 0 unless the bot is addressed (a quiet group stays quiet). */
export function createMediaSkills(deps: MediaSkillDeps): Skill[] {
  const course = deps.courseId ?? (() => 'demo');
  const chaptersOf = (m: InboundMessage) => deps.store.listChapters(course(m));
  const members = (chatId: string): StudentId[] =>
    (
      deps.store.db.prepare('SELECT student_id FROM chat_members WHERE chat_id=?').all(chatId) as {
        student_id: string;
      }[]
    )
      .map((r) => r.student_id)
      .sort();

  const podcast: Skill = {
    name: 'podcast',
    async match(m) {
      return m.mentionsBot && PODCAST_RE.test(m.text) ? 0.92 : 0;
    },
    async handle(m, ctx): Promise<OutboundMessage[]> {
      const courseId = course(m);
      const chapter = pickChapter(m.text, chaptersOf(m));
      if (!chapter) return [{ chatId: m.chatId, text: NO_CHAPTER }];
      // A DM is always the personal cut; in a group, "my"/"for me" asks for the personal cut.
      const personal = !m.isGroup || PERSONAL_RE.test(m.text);
      try {
        const r = await makePodcast(
          {
            ...deps.podcast,
            material: podcastMaterial(deps.store, deps.mastery, members),
            outDir: join(deps.outDir, 'podcast'),
          },
          { courseId, chapter, chatId: m.chatId, audience: personal ? m.from : 'squad' },
        );
        if (r.dm) {
          await ctx.dm(r.dm, r.message.text ?? '', r.message.attachments);
          return m.isGroup ? [{ chatId: m.chatId, text: 'Sent you a DM.' }] : [];
        }
        return [r.message];
      } catch {
        return [{ chatId: m.chatId, text: MEDIA_UNAVAILABLE }];
      }
    },
  };

  const explainer: Skill = {
    name: 'explainer',
    async match(m) {
      return m.mentionsBot && EXPLAINER_RE.test(m.text) ? 0.92 : 0;
    },
    async handle(m): Promise<OutboundMessage[]> {
      const courseId = course(m);
      const chapter = pickChapter(m.text, chaptersOf(m));
      if (!chapter) return [{ chatId: m.chatId, text: NO_CHAPTER }];
      try {
        const r = await makeExplainer(
          {
            ...deps.explainer,
            material: explainerMaterial(deps.store),
            outDir: join(deps.outDir, 'explainer'),
          },
          { courseId, chapter, chatId: m.chatId, question: m.text.replace(/^@\w+\s*/, '').trim() },
        );
        return [r.message];
      } catch {
        return [{ chatId: m.chatId, text: MEDIA_UNAVAILABLE }];
      }
    },
  };
  return [podcast, explainer];
}
