import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Sheet, Skeleton, TextField } from '../../primitives';
import { HubError, type LibraryApi } from './api';
import { deleteConfirmed, deleteSummary, errorMessage } from './model';
import type { Counts } from './types';

/* ------------------------------------------------------------------ create */

export function CreateCourseSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setTitle('');
      setError(null);
      setBusy(false);
    }
  }, [open]);
  const valid = title.trim().length > 0;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(title.trim());
    } catch (e) {
      setError(errorMessage(e instanceof HubError ? e.code : 'network'));
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New course"
      description="Give it the name you use for the class. You add files next. It starts private, so only you can read it."
      initialFocusRef={ref}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={busy}
            onClick={submit}
            data-testid="create-course-submit"
          >
            Create course
          </Button>
        </>
      }
    >
      <form
        className="cr-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          ref={ref}
          label="Course title"
          value={title}
          onChange={setTitle}
          maxLength={80}
          placeholder="BIO 201: Cell Biology"
          autoComplete="off"
          error={error ?? undefined}
          required
        />
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ delete */

export function DeleteCourseSheet({
  open,
  onClose,
  api,
  course,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  api: LibraryApi;
  course: { id: string; title: string };
  onDeleted: () => void;
}) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setCounts(null);
    setLoadErr(null);
    setTyped('');
    setFailed(null);
    setBusy(false);
    // Ask first: without confirm the hub answers 409 confirm_required with what would go.
    api.deleteCourse(course.id, false).then(
      () => {
        if (live) onDeleted();
      },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof HubError && e.code === 'confirm_required') {
          setCounts(e.extra.counts ?? { pages: 0, chapters: 0, files: 0 });
        } else setLoadErr(errorMessage(e instanceof HubError ? e.code : 'network'));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course.id, attempt, api]);

  const ok = counts !== null && deleteConfirmed(typed, course.title, false);
  const confirm = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.deleteCourse(course.id, true);
      onDeleted();
    } catch (e) {
      setFailed(errorMessage(e instanceof HubError ? e.code : 'network'));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Delete this course?"
      description={`"${course.title}" and everything Squad built from it will be removed. This cannot be undone.`}
      initialFocusRef={ref}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            iconStart="trash"
            disabled={!ok}
            loading={busy}
            onClick={confirm}
            data-testid="delete-confirm"
          >
            Delete course
          </Button>
        </>
      }
    >
      <div className="cr-form">
        {counts === null && !loadErr && (
          <div role="status" aria-busy="true" className="cr-stack">
            <span className="cr-vh">Checking what would be removed</span>
            <Skeleton shape="line" width="90%" />
            <Skeleton shape="line" width="70%" />
          </div>
        )}
        {loadErr && (
          <Notice
            tone="error"
            title="We could not check what this removes"
            action={
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          >
            {loadErr}
          </Notice>
        )}
        {counts && (
          <p className="cr-delete-summary" data-testid="delete-summary">
            {deleteSummary(counts)}
          </p>
        )}
        <TextField
          ref={ref}
          label={`Type the course title to confirm`}
          hint={course.title}
          value={typed}
          onChange={setTyped}
          autoComplete="off"
          spellCheck={false}
          disabled={counts === null}
          data-testid="delete-title-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void confirm();
            }
          }}
        />
        {failed && (
          <Notice tone="error" title="The course was not deleted">
            {failed}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}
