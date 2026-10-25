import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StateBlock } from '../../overlays/kit';
import { Button, Notice, Skeleton, Switch, TextField, useToast } from '../../primitives';
import { HubError, type LibraryApi } from './api';
import { ChaptersPanel } from './ChaptersPanel';
import { FilesPanel } from './FilesPanel';
import {
  canDelete,
  errorMessage,
  mergeChapters,
  renameChapter,
  splitChapter,
  withChapters,
} from './model';
import { CataloguePanel, PolicyPanel } from './PanelsMisc';
import { CourseStatusChip, RoleChip, VisibilityChip } from './parts';
import { DeleteCourseSheet } from './Sheets';
import { openSource } from './source';
import type { CatalogueState, ChapterRow, CourseDetail, FileRow, Limits } from './types';
import { useCourseDetail, useUploads } from './useLibrary';

const msg = (e: unknown) => errorMessage(e instanceof HubError ? e.code : 'network');

export function CourseDetailView({
  api,
  id,
  limits,
  onChanged,
}: {
  api: LibraryApi;
  id: string;
  limits: Limits;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const d = useCourseDetail(api, id);
  const { course, status, setCourse } = d;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueState | null>(null);
  const uploads = useUploads({
    api,
    courseId: id,
    limits,
    existingCount: course?.files.length ?? 0,
    onUploaded: () => {
      void d.refresh();
      onChanged();
    },
  });

  useEffect(() => {
    api.getCatalogue().then(setCatalogue, () => undefined);
  }, [api]);

  /** Optimistic edit: apply now, call the hub, put the old value back and say so if it fails. */
  const optimistic = useCallback(
    async (
      apply: (c: CourseDetail) => CourseDetail,
      call: () => Promise<void>,
      failTitle: string,
    ) => {
      if (!course) return;
      const before = course;
      setCourse(apply(before));
      try {
        await call();
        void d.refresh();
        onChanged();
      } catch (e) {
        setCourse(before);
        toast({ title: failTitle, body: msg(e), tone: 'error' });
      }
    },
    [course, setCourse, toast, onChanged],
  );

  if (status === 'loading' || (!course && status === 'ready')) {
    return (
      <div
        className="sq-page sq-page--wide cr-page"
        role="status"
        aria-busy="true"
        data-testid="detail-loading"
      >
        <span className="cr-vh">Loading course</span>
        <Skeleton shape="line" width="40%" height={32} />
        <Skeleton shape="block" height={200} />
        <Skeleton shape="block" height={280} />
      </div>
    );
  }
  if (status === 'missing') {
    return (
      <div className="sq-page cr-page" data-testid="detail-missing">
        <StateBlock
          kind="empty"
          art="books"
          title="This course is not here"
          body="It may have been deleted, or you no longer have access."
        />
        <Button
          variant="secondary"
          iconStart="chevron-left"
          onClick={() => navigate('/squad/courses')}
        >
          All courses
        </Button>
      </div>
    );
  }
  if (status === 'offline' || status === 'error' || !course) {
    return (
      <div
        className="sq-page cr-page"
        data-testid={status === 'offline' ? 'detail-offline' : 'detail-error'}
      >
        <StateBlock
          kind={status === 'offline' ? 'offline' : 'error'}
          title={status === 'offline' ? 'You are offline' : 'This course did not load'}
          body={
            status === 'offline'
              ? 'It loads when your connection is back.'
              : 'Squad did not answer. Try again.'
          }
          onRetry={d.reload}
          retryLabel={status === 'offline' ? 'Check again' : 'Try again'}
        />
      </div>
    );
  }

  const c = course;
  const can = c.canEdit && !c.sample;
  const del = canDelete(c);
  const chapters = c.chapters;
  const saveTitle = () => {
    const t = draft.trim();
    setEditing(false);
    if (!t || t === c.title) return;
    void optimistic(
      (x) => ({ ...x, title: t }),
      () => api.patchCourse(c.id, { title: t }),
      'Rename failed',
    );
  };
  const showExisting = (fid: string) => {
    setHighlight(fid);
    const el = document.getElementById(`file-${fid}`);
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus({ preventScroll: true });
    setTimeout(() => setHighlight(null), 2400);
  };
  const chapterEdit = (
    apply: (cs: ChapterRow[]) => ChapterRow[],
    call: () => Promise<void>,
    fail: string,
  ) => optimistic((x) => withChapters(x, apply(x.chapters)), call, fail);

  return (
    <div
      className="sq-page sq-page--wide cr-page"
      data-testid="course-detail"
      data-course-id={c.id}
    >
      <nav aria-label="Breadcrumb">
        <Button
          as="a"
          href="/squad/courses"
          variant="ghost"
          iconStart="chevron-left"
          onClick={(e) => {
            e.preventDefault();
            navigate('/squad/courses');
          }}
        >
          All courses
        </Button>
      </nav>
      <header className="cr-dhead">
        <div className="cr-dhead__title">
          {editing ? (
            <form
              className="cr-inline"
              onSubmit={(e) => {
                e.preventDefault();
                saveTitle();
              }}
            >
              <TextField
                label="Course title"
                value={draft}
                onChange={setDraft}
                autoFocus
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(false);
                }}
                data-testid="course-title-input"
              />
              <Button type="submit" variant="primary">
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="cr-titlerow">
              <h1
                className="sq-page__title"
                tabIndex={-1}
                data-page-title
                data-testid="course-title"
              >
                {c.title}
              </h1>
              {can && (
                <Button
                  variant="ghost"
                  iconStart="sparkle"
                  onClick={() => {
                    setDraft(c.title);
                    setEditing(true);
                  }}
                  data-testid="course-rename"
                >
                  Rename
                </Button>
              )}
            </div>
          )}
          {c.attribution && (
            <p className="cr-attrib" data-testid="course-attribution">
              {c.attribution}
            </p>
          )}
          <div className="cr-chips">
            <RoleChip role={c.role} />
            {c.role === 'owner' && <VisibilityChip visibility={c.visibility} />}
            <CourseStatusChip status={c.status} />
          </div>
        </div>
        <div className="cr-dhead__actions">
          <Button
            variant="danger"
            iconStart="trash"
            disabled={!del.ok}
            onClick={() => setDelOpen(true)}
            data-testid="delete-course"
            aria-describedby={del.ok ? undefined : 'cr-del-why'}
          >
            Delete course
          </Button>
          {!del.ok && (
            <p id="cr-del-why" className="cr-muted" data-testid="delete-reason">
              {del.reason}
            </p>
          )}
        </div>
      </header>

      {c.role === 'owner' && (
        <section
          className="cr-panel cr-vis"
          aria-labelledby="cr-vis-h"
          data-testid="visibility-panel"
        >
          <div>
            <h2 id="cr-vis-h" className="cr-panel__title">
              Who can read this
            </h2>
            <p className="cr-muted">
              Your squad can read these materials. Your notes, quiz answers and mastery stay
              private.
            </p>
          </div>
          <Switch
            label={c.visibility === 'squad' ? 'Shared with your squad' : 'Private to you'}
            checked={c.visibility === 'squad'}
            disabled={!can}
            onCheckedChange={(on) => {
              const visibility = on ? 'squad' : 'private';
              void optimistic(
                (x) => ({ ...x, visibility }),
                () => api.patchCourse(c.id, { visibility }),
                'Sharing was not changed',
              );
            }}
          />
        </section>
      )}

      {c.status === 'failed' && (
        <Notice tone="error" title="None of the files could be read">
          Retry them below, or upload a text version.
        </Notice>
      )}

      <div className="cr-cols">
        <FilesPanel
          files={c.files}
          uploads={uploads.items}
          limits={limits}
          canEdit={can}
          announce={d.announce}
          highlight={highlight}
          onAdd={uploads.add}
          onRetryUpload={uploads.retry}
          onDismissUpload={uploads.dismiss}
          onShowExisting={showExisting}
          onRetryFile={(f: FileRow) =>
            void optimistic(
              (x) => ({
                ...x,
                files: x.files.map((y) =>
                  y.fileId === f.fileId ? { ...y, status: 'queued', pct: 0, error: undefined } : y,
                ),
              }),
              () => api.reingest(f.fileId),
              'Could not retry',
            )
          }
          onRemoveFile={(f: FileRow) =>
            void optimistic(
              (x) => ({ ...x, files: x.files.filter((y) => y.fileId !== f.fileId) }),
              () => api.removeFile(f.fileId),
              'Could not remove the file',
            ).then(() => toast({ title: `Removed ${f.name}`, tone: 'ok' }))
          }
        />
        <ChaptersPanel
          chapters={chapters}
          canEdit={can}
          onOpen={(ch) => openSource({ file: ch.file, page: ch.pageStart, courseId: c.id })}
          onRename={(chId, title) =>
            void chapterEdit(
              (cs) => renameChapter(cs, chId, title),
              () => api.renameChapter(c.id, chId, title),
              'Rename failed',
            )
          }
          onSplit={(ch, atPage, title) =>
            void chapterEdit(
              (cs) => splitChapter(cs, { chapter: ch.id, atPage, title }, `tmp_${ch.id}_${atPage}`),
              () => api.splitChapter(c.id, { chapter: ch.id, atPage, title }),
              'Split failed',
            ).then(() => toast({ title: 'Chapter split', tone: 'ok' }))
          }
          onMerge={(from, into) =>
            void chapterEdit(
              (cs) => mergeChapters(cs, { from: from.id, into: into.id }),
              () => api.mergeChapters(c.id, { from: from.id, into: into.id }),
              'Merge failed',
            ).then(() => toast({ title: 'Chapters merged', tone: 'ok' }))
          }
        />
      </div>

      <PolicyPanel
        policy={c.policy}
        courseId={c.id}
        canEdit={can}
        onPaste={async (text) => {
          try {
            await api.putSyllabus(c.id, text);
            await d.refresh();
            toast({ title: 'Syllabus policy updated', tone: 'ok' });
          } catch (e) {
            toast({ title: 'Could not read the syllabus', body: msg(e), tone: 'error' });
          }
        }}
        onUpload={(f) => uploads.add([f], 'syllabus')}
      />
      <CataloguePanel
        catalogue={catalogue}
        canImport={can}
        onImport={async (p, body, type) => {
          try {
            setCatalogue(await api.putCatalogue(p.rows, body, type));
            toast({ title: 'Catalogue imported', tone: 'ok' });
          } catch (e) {
            toast({ title: 'Catalogue not imported', body: msg(e), tone: 'error' });
          }
        }}
      />

      <DeleteCourseSheet
        open={delOpen}
        onClose={() => setDelOpen(false)}
        api={api}
        course={{ id: c.id, title: c.title }}
        onDeleted={() => {
          setDelOpen(false);
          toast({ title: `Deleted ${c.title}`, tone: 'ok' });
          onChanged();
          navigate('/squad/courses');
        }}
      />
    </div>
  );
}
