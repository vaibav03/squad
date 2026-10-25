import { useRef, useState } from 'react';
import { Button, Notice, Sheet, TextField } from '../../primitives';
import { MasteryTag } from './parts';
import { mergeTarget, plural, splitProblem } from './model';
import type { ChapterRow } from './types';

export function ChaptersPanel({
  chapters,
  canEdit,
  onRename,
  onSplit,
  onMerge,
  onOpen,
}: {
  chapters: ChapterRow[];
  canEdit: boolean;
  onRename: (id: string, title: string) => void;
  onSplit: (c: ChapterRow, atPage: number, title: string) => void;
  onMerge: (from: ChapterRow, into: ChapterRow) => void;
  onOpen: (c: ChapterRow) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [splitting, setSplitting] = useState<ChapterRow | null>(null);
  const commit = (c: ChapterRow) => {
    const t = draft.trim();
    setEditing(null);
    if (t && t !== c.title) onRename(c.id, t);
  };
  return (
    <section className="cr-panel" aria-labelledby="cr-chap-h" data-testid="chapters-panel">
      <header className="cr-panel__head">
        <div>
          <h2 id="cr-chap-h" className="cr-panel__title">
            Chapters
          </h2>
          <p className="cr-muted">{plural(chapters.length, 'chapter')}. Mastery is your own.</p>
        </div>
      </header>
      {chapters.length === 0 ? (
        <p className="cr-muted" data-testid="chapters-empty">
          Chapters appear once a file has been read.
        </p>
      ) : (
        <ol className="cr-chaps">
          {chapters.map((c, i) => {
            const next = mergeTarget(chapters, c.id);
            return (
              <li key={c.id} className="cr-chap" data-testid="chapter-item" data-chapter-id={c.id}>
                <span className="cr-chap__n" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="cr-chap__main">
                  {editing === c.id ? (
                    <form
                      className="cr-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        commit(c);
                      }}
                    >
                      <TextField
                        label="Chapter title"
                        value={draft}
                        onChange={setDraft}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                        data-testid="chapter-title-input"
                      />
                      <Button type="submit" variant="primary">
                        Save
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <p className="cr-chap__title" data-testid="chapter-title">
                      {c.title}
                    </p>
                  )}
                  <p className="cr-file__meta">
                    <span>
                      pages {c.pageStart} to {c.pageEnd}
                    </span>
                    <MasteryTag mastery={c.mastery} />
                  </p>
                  {c.summary && <p className="cr-muted cr-chap__sum">{c.summary}</p>}
                  <div className="cr-chap__actions">
                    <Button
                      variant="secondary"
                      iconStart="book"
                      onClick={() => onOpen(c)}
                      data-testid="chapter-open"
                    >
                      Open source
                    </Button>
                    {canEdit && editing !== c.id && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setDraft(c.title);
                            setEditing(c.id);
                          }}
                          aria-label={`Rename ${c.title}`}
                          data-testid="chapter-rename"
                        >
                          Rename
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={c.pageCount < 2}
                          onClick={() => setSplitting(c)}
                          aria-label={`Split ${c.title} at a page`}
                          data-testid="chapter-split"
                        >
                          Split
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!next}
                          onClick={() => next && onMerge(next, c)}
                          aria-label={`Merge ${c.title} with the next chapter`}
                          data-testid="chapter-merge"
                        >
                          Merge with next
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {splitting && (
        <SplitSheet
          chapter={splitting}
          onClose={() => setSplitting(null)}
          onSplit={(page, title) => {
            onSplit(splitting, page, title);
            setSplitting(null);
          }}
        />
      )}
    </section>
  );
}

function SplitSheet({
  chapter,
  onClose,
  onSplit,
}: {
  chapter: ChapterRow;
  onClose: () => void;
  onSplit: (page: number, title: string) => void;
}) {
  const mid = Math.min(
    chapter.pageEnd,
    Math.max(chapter.pageStart + 1, Math.round((chapter.pageStart + chapter.pageEnd) / 2)),
  );
  const [page, setPage] = useState(String(mid));
  const [title, setTitle] = useState(`${chapter.title} (part 2)`);
  const ref = useRef<HTMLInputElement>(null);
  const problem = splitProblem(chapter, Number(page), title);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Split chapter"
      description={`${chapter.title} covers pages ${chapter.pageStart} to ${chapter.pageEnd}. Pick the page where the new chapter starts.`}
      initialFocusRef={ref}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!!problem}
            onClick={() => onSplit(Number(page), title.trim())}
            data-testid="split-confirm"
          >
            Split here
          </Button>
        </>
      }
    >
      <form
        className="cr-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) onSplit(Number(page), title.trim());
        }}
      >
        <TextField
          ref={ref}
          label="Starts on page"
          type="number"
          inputMode="numeric"
          min={chapter.pageStart + 1}
          max={chapter.pageEnd}
          value={page}
          onChange={setPage}
          data-testid="split-page"
        />
        <input
          className="cr-range"
          type="range"
          aria-label="Page picker"
          min={chapter.pageStart + 1}
          max={chapter.pageEnd}
          value={Number(page) || chapter.pageStart + 1}
          onChange={(e) => setPage(e.target.value)}
        />
        <TextField label="New chapter title" value={title} onChange={setTitle} />
        {problem && <Notice tone="warn">{problem}</Notice>}
      </form>
    </Sheet>
  );
}
