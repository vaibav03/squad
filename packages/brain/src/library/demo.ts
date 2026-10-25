import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { FIXTURE_DIR, loadFixtureCourse } from '../ingest';
import { newFileId } from './ids';
import { MIME, sha256Hex } from './sniff';
import type { LibraryStore } from './store';
import { DEMO_COURSE_ID, DEMO_OWNER } from './types';

const Spec = z.object({ chapters: z.array(z.object({ file: z.string() })) });

/**
 * Makes the bundled OpenStax sample course visible to everyone as `public`, read-only. Ingests it
 * offline (no Llm) when it is not in the course tables yet. Idempotent.
 */
const inflight = new WeakMap<LibraryStore, Promise<void>>();
export function ensureDemoCourse(lib: LibraryStore): Promise<void> {
  let p = inflight.get(lib);
  if (!p) {
    p = seed(lib).catch((e: unknown) => {
      inflight.delete(lib); // retry on the next listing
      throw e;
    });
    inflight.set(lib, p);
  }
  return p;
}

async function seed(lib: LibraryStore): Promise<void> {
  const have = lib.courses.getCourse(DEMO_COURSE_ID);
  if (!have || have.chapters.length === 0)
    await loadFixtureCourse({ store: lib.courses }, DEMO_COURSE_ID);
  lib.registerCourse({
    courseId: DEMO_COURSE_ID,
    owner: DEMO_OWNER,
    visibility: 'public',
    sample: true,
  });
  if (lib.files(DEMO_COURSE_ID).length > 0) return;
  const spec = Spec.parse(JSON.parse(await readFile(join(FIXTURE_DIR, 'course.json'), 'utf8')));
  for (const ch of spec.chapters) {
    const path = join(FIXTURE_DIR, 'openstax', ch.file);
    const bytes = new Uint8Array(await readFile(path).catch(() => Buffer.alloc(0)));
    const pages = lib.courses.getPages(DEMO_COURSE_ID).filter((p) => p.file === ch.file).length;
    if (pages === 0) continue;
    lib.addFile({
      fileId: newFileId(),
      courseId: DEMO_COURSE_ID,
      owner: DEMO_OWNER,
      name: ch.file,
      kind: 'material',
      mime: MIME.pdf,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      pages,
      status: 'ready',
      pct: 100,
      errorCode: null,
      errorMessage: null,
      storedPath: bytes.length > 0 ? path : null, // read-only fixture; never inside dataDir, never unlinked
      uploadedAt: 0,
    });
  }
}
