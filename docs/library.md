# Course library (contract, v1)

Owner: `product/courses`. Everything here is grounded in the student's own course materials, so the library is where a student sees, manages and trusts them.

Code: brain `packages/brain/src/library/**` (pure logic + sqlite store), hub `apps/hub/src/routes/library.ts` (HTTP), web `packages/web/src/pages/courses/**` (route `/squad/courses`), viewer `packages/web/src/components/source-viewer/**`.

## Ownership and privacy
- Every uploaded course has an owner (student id) and `visibility`: `private` (default, owner only), `squad` (explicit opt-in: squadmates may read materials, excerpts and policy lines), `public` (only the bundled OpenStax sample, read-only, CC BY 4.0 attribution shown).
- Course and file ids are unguessable (`c_` / `f_` + 16 random bytes base64url). A viewer that may not read a course gets `404 not_found` (never 403, so existence does not leak), including on `/source`.
- Squad sharing exposes materials only. Never another student's notes, quiz answers or mastery. Mastery on the page is always the viewer's own.

## HTTP (Bearer viewer token on all routes; errors `{ error: { code } }`)
| Route | Notes |
|---|---|
| `GET /v1/library/courses` | `{ courses: CourseSummary[], limits }` the viewer can read |
| `POST /v1/library/courses` `{ title }` | creates a private course -> `CourseSummary` |
| `GET /v1/library/courses/:id` | `CourseDetail` |
| `PATCH /v1/library/courses/:id` `{ title?, visibility? }` | owner only |
| `DELETE /v1/library/courses/:id` `{ confirm: true }` | owner only; cascades pages, chapters, files on disk, quiz rows, mastery rows, caches; returns `{ deleted: Counts }`; without `confirm:true` -> 409 `confirm_required` with the `Counts` that would go |
| `POST /v1/library/courses/:id/files` multipart `file`, `kind=material\|syllabus` | validates type (pdf, txt, md, pptx-as-pdf), size, page cap; 202 `{ fileId, status:'queued' }`; same sha256 in the course -> 409 `duplicate` `{ fileId }` |
| `GET /v1/library/files/:fileId` | `FileRow` (status, pct, error) for polling; live progress also arrives as `x.ingest.progress` |
| `POST /v1/library/files/:fileId/reingest` / `DELETE /v1/library/files/:fileId` | owner only |
| `GET /v1/library/files/:fileId/raw` | original bytes, `content-disposition: inline`, owner or (squad-visible) squadmate |
| `POST /v1/library/courses/:id/chapters/split` `{ chapter, atPage, title }` / `.../merge` `{ from, into }` / `PATCH .../chapters/:chId` `{ title }` | chapter editor |
| `PUT /v1/library/courses/:id/syllabus` `{ text }` | stores the syllabus and extracts policy; file upload with `kind=syllabus` does the same |
| `GET /v1/library/catalogue`, `PUT /v1/library/catalogue` (JSON or CSV body, `content-type`) | planner catalogue; sample is always labelled `sample:true` |
| `GET /v1/library/source?file=&page=&quote=&courseId=` | one cited excerpt, see `SourceExcerpt` |

```ts
type IngestStatus = 'queued'|'parsing'|'embedding'|'ready'|'failed';
interface CourseSummary { id; title; role:'owner'|'squad'|'public'; visibility:'private'|'squad'|'public';
  sample:boolean; attribution?:string; fileCount; chapterCount; pageCount;
  status:'empty'|'ingesting'|'ready'|'failed'; updatedAt:number; chapters: ChapterRow[] }
interface ChapterRow { id; title; summary; file; pageStart; pageEnd; pageCount; mastery: { word:'new'|'learning'|'steady'|'strong'; box:number }|null }
interface FileRow { fileId; name; kind:'material'|'syllabus'; mime; size; pages:number|null; sha256: string /* first 12 hex */; status:IngestStatus; pct:number; error?: { code; message }; uploadedAt:number }
interface CourseDetail extends CourseSummary { files:FileRow[]; policy: PolicyPanel|null; canEdit:boolean }
interface PolicyPanel { sourceFile:string|null; lines:{ n:number; text:string; verbatim:true; topic:'homework'|'ai'|'collaboration'|'integrity'|'other' }[] }
interface SourceExcerpt { ok:true; courseId; fileId:string; file; page; pageCount; lines:{ n:number; text:string; hit:boolean }[]; quote:string|null; quoteVerified:boolean; imageUrl:string|null; openUrl:string }
  | { ok:false; reason:'removed'|'page_missing'|'not_found' }
```
Mastery words (no grades): box 0 new, 1-2 learning, 3-4 steady, 5 strong.

## Limits (all returned in `limits` so the UI never hardcodes them)
25 MB per file, 400 pages per file, 2000 pages per course, 40 files per course, 30 s parse timeout, PDFs with `/JS`, `/JavaScript`, `/Launch`, `/EmbeddedFile` actions are rejected (`unsafe_pdf`); the parser never executes anything.

## Source viewer API

`import { SourceViewerHost, openSource, useOpenSource, CitationChip, parseCitationString, SourceExcerptView } from '@squad/web'` (code: `packages/web/src/components/source-viewer`).

- `<SourceViewerHost />` mount once per page (courses page; chat, council card and room transcripts may mount their own). Sheet: bottom on phones, right at >= 768px. Reads `useLiveConfig()`: live mode calls `GET {hubUrl}/v1/library/source` with the Bearer token, any other mode uses built-in fixtures (`openstax-biology.pdf` verified/unverified quote; file names containing `removed` or `missing` give the removed / not_found states).
- `openSource({ file, page, quote?, courseId?, returnFocusTo? })` module-level; queues (dev warning) if no host is mounted yet. Focus returns to `returnFocusTo`, else the element focused at call time. `useOpenSource()` returns the same function.
- `<CitationChip citation={{file,page,quote?,courseId?}} onOpen? />` renders `slides.pdf p.12` and calls `openSource`.
- `parseCitationString('[file p.N]' | '(file p.N)') -> { file, page } | null`.
- `<SourceExcerptView excerpt state='loading'|'ready'|'error'|'offline' />` pure view for tests/gallery.
- Results are cached per (course, file, page, quote) for the session, in-flight requests are deduped and aborted when the viewer closes. "Open in file" fetches the raw file with the token and opens an object URL at `#page=N` (plain href fallback).
