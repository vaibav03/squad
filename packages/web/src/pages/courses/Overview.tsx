import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LvIcon, Segmented, StateBlock, propArt } from '../../overlays/kit';
import { Button, EmptyState, Notice, Page, Skeleton } from '../../primitives';
import { Dot, CourseStatusChip, MasteryTag, RoleChip, VisibilityChip } from './parts';
import { plural } from './model';
import type { LoadStatus } from './useLibrary';
import type { CourseSummary } from './types';

export type ViewMode = 'grid' | 'list';
const VIEW_KEY = 'squad.courses.view';

export function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}
export function saveView(v: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private mode or blocked storage: the choice just does not persist */
  }
}

const PREVIEW = 4;

export interface OverviewProps {
  status: LoadStatus;
  courses: CourseSummary[];
  onRetry: () => void;
  onNew: () => void;
  onSample: () => void;
}

export function Overview({ status, courses, onRetry, onNew, onSample }: OverviewProps) {
  const [view, setView] = useState<ViewMode>(loadView);
  useEffect(() => saveView(view), [view]);
  const mine = courses.filter((c) => c.role === 'owner');
  return (
    <Page
      className="cr-page"
      width="wide"
      eyebrow="Library"
      title="Courses"
      actions={
        <Button variant="primary" iconStart="plus" onClick={onNew} data-testid="new-course">
          New course
        </Button>
      }
    >
      <p className="lv-lede">
        Everything Squad knows about your classes comes from the materials you add here. You decide
        who can read them.
      </p>

      {status === 'loading' && (
        <div className="cr-grid" role="status" aria-busy="true" data-testid="courses-loading">
          <span className="cr-vh">Loading your courses</span>
          {[0, 1, 2].map((i) => (
            <div className="cr-card cr-card--skel" key={i}>
              <Skeleton shape="line" width="60%" height={22} />
              <Skeleton shape="line" width="40%" />
              <Skeleton shape="block" height={120} />
            </div>
          ))}
        </div>
      )}
      {status === 'error' && (
        <div data-testid="courses-error">
          <StateBlock
            kind="error"
            title="Your courses did not load"
            body="The hub did not answer. Nothing was changed. Try again."
            onRetry={onRetry}
          />
        </div>
      )}
      {status === 'offline' && (
        <div data-testid="courses-offline">
          <StateBlock
            kind="offline"
            title="You are offline"
            body="Your courses show up when your connection is back."
            onRetry={onRetry}
            retryLabel="Check again"
          />
        </div>
      )}

      {status === 'ready' && courses.length === 0 && (
        <div className="cr-empty" data-testid="courses-empty">
          <EmptyState
            title="Add your first course"
            body="Upload a syllabus or lecture PDFs and Squad can quiz you, plan your week, and show where each answer came from."
            art={
              <img
                className="sq-sprite"
                src={propArt.books.url}
                width={propArt.books.w * 3}
                height={propArt.books.h * 3}
                alt=""
              />
            }
            action={
              <div className="cr-row">
                <Button variant="primary" iconStart="upload" onClick={onNew}>
                  Upload a course
                </Button>
                <Button variant="secondary" iconStart="book" onClick={onSample}>
                  Try the sample course
                </Button>
              </div>
            }
          />
        </div>
      )}

      {status === 'ready' && courses.length > 0 && (
        <>
          <div className="cr-toolbar">
            <p className="cr-count" aria-live="polite">
              {plural(courses.length, 'course')}
            </p>
            <Segmented
              label="Course layout"
              value={view}
              onChange={setView}
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'list', label: 'List' },
              ]}
            />
          </div>
          {mine.length === 0 && (
            <Notice
              tone="info"
              title="You have not added a course yet"
              action={
                <Button variant="secondary" iconStart="upload" onClick={onNew}>
                  Upload your own
                </Button>
              }
            >
              Start with the sample below to see how chapters and sources work, then add your own
              materials.
            </Notice>
          )}
          <ul
            className={view === 'grid' ? 'cr-grid' : 'cr-list'}
            data-testid="course-list"
            data-view={view}
          >
            {courses.map((c) => (
              <li key={c.id}>
                <CourseCard course={c} view={view} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

export function CourseCard({ course: c, view }: { course: CourseSummary; view: ViewMode }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const href = `/squad/courses/${encodeURIComponent(c.id)}`;
  const preview = view === 'list' ? 0 : PREVIEW;
  const shown = expanded ? c.chapters : c.chapters.slice(0, preview);
  const listId = `cr-ch-${c.id}`;
  return (
    <article
      className="cr-card"
      data-view={view}
      data-testid="course-card"
      data-course-id={c.id}
      aria-labelledby={`cr-t-${c.id}`}
    >
      <header className="cr-card__head">
        <div className="cr-card__title">
          <h2 id={`cr-t-${c.id}`}>
            <a
              href={href}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate(href);
              }}
            >
              {c.title}
            </a>
          </h2>
          {c.attribution && (
            <p className="cr-attrib" data-testid="course-attribution">
              {c.attribution}
            </p>
          )}
        </div>
        <div className="cr-chips">
          <RoleChip role={c.role} />
          {c.role === 'owner' && <VisibilityChip visibility={c.visibility} />}
          <CourseStatusChip status={c.status} />
        </div>
      </header>

      <p className="cr-counts" data-testid="course-counts">
        <span>{plural(c.fileCount, 'file')}</span>
        <Dot />
        <span>{plural(c.chapterCount, 'chapter')}</span>
        <Dot />
        <span>{plural(c.pageCount, 'page')}</span>
      </p>

      {c.chapters.length > 0 && (
        <div className="cr-chapters">
          {shown.length > 0 && (
            <ul id={listId} className="cr-chlist" aria-label={`Chapters in ${c.title}`}>
              {shown.map((ch) => (
                <li key={ch.id} className="cr-chrow" data-testid="chapter-row">
                  <span className="cr-chrow__title">{ch.title}</span>
                  <MasteryTag mastery={ch.mastery} />
                </li>
              ))}
            </ul>
          )}
          {c.chapters.length > preview && (
            <Button
              variant="ghost"
              size="md"
              className="cr-more"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((v) => !v)}
              data-testid="chapters-toggle"
            >
              {expanded
                ? preview === 0
                  ? 'Hide chapters'
                  : 'Show fewer chapters'
                : preview === 0
                  ? `Show ${plural(c.chapters.length, 'chapter')}`
                  : `Show all ${c.chapters.length} chapters`}
            </Button>
          )}
        </div>
      )}
      {c.chapters.length === 0 && (
        <p className="cr-muted cr-nochap">
          {c.status === 'ingesting'
            ? 'Chapters appear once your files are read.'
            : 'No chapters yet. Add a PDF and they show up here.'}
        </p>
      )}

      <footer className="cr-card__foot">
        <Button
          as="a"
          href={href}
          variant="secondary"
          iconEnd="arrow-right"
          onClick={(e) => {
            const ev = e as unknown as MouseEvent;
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
            e.preventDefault();
            navigate(href);
          }}
          aria-label={`Open ${c.title}`}
        >
          Open course
        </Button>
      </footer>
    </article>
  );
}

export { LvIcon };
