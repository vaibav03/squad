import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button, Chip, Icon, Notice, ProgressBar } from '../../primitives';
import { LvIcon } from '../../overlays/kit';
import { Dot, FileStatusChip } from './parts';
import { errorMessage, extOf, formatBytes, isTerminal, plural, shortSha } from './model';
import type { FileRow, Limits } from './types';
import type { UploadItem } from './useLibrary';

export const PII_WARNING = "Do not upload graded work or other people's private files.";

/* -------------------------------------------------------------- drop zone */

export function DropZone({
  limits,
  disabled,
  onFiles,
}: {
  limits: Limits;
  disabled?: boolean;
  onFiles: (files: File[], kind: 'material' | 'syllabus') => void;
}) {
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const pick = useRef<HTMLInputElement>(null);
  const syl = useRef<HTMLInputElement>(null);
  const accept = limits.accept.map((x) => `.${x}`).join(',');

  // paste a copied file anywhere on the page, unless the student is typing in a field
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        onFiles(files, 'material');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [disabled, onFiles]);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return (
    <div className="cr-drop-wrap">
      <div
        className="cr-drop"
        data-drag={drag || undefined}
        data-disabled={disabled || undefined}
        data-testid="dropzone"
        role="group"
        aria-label="Add files"
        onDragEnter={(e) => {
          if (disabled || !hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDrag(true);
        }}
        onDragOver={(e) => {
          if (disabled || !hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDrag(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onFiles(files, 'material');
        }}
      >
        <span className="cr-drop__icon" aria-hidden="true">
          <Icon name="upload" size={22} />
        </span>
        <div className="cr-drop__text">
          <p className="cr-drop__title">Drop files here, or paste them</p>
          <p className="cr-muted">
            {limits.accept.map((x) => x.toUpperCase()).join(', ')} · up to{' '}
            {formatBytes(limits.maxFileBytes)} and {limits.maxPagesPerFile} pages each · slides as
            PDF
          </p>
        </div>
        <div className="cr-row">
          <Button
            variant="primary"
            iconStart="plus"
            disabled={disabled}
            onClick={() => pick.current?.click()}
            data-testid="choose-files"
          >
            Choose files
          </Button>
          <Button
            variant="secondary"
            iconStart="file"
            disabled={disabled}
            onClick={() => syl.current?.click()}
            data-testid="choose-syllabus"
          >
            Upload syllabus
          </Button>
        </div>
        <input
          ref={pick}
          className="cr-vh"
          type="file"
          multiple
          accept={accept}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files, 'material');
          }}
        />
        <input
          ref={syl}
          className="cr-vh"
          type="file"
          accept={accept}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="syllabus-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files, 'syllabus');
          }}
        />
      </div>
      <p className="cr-pii" data-testid="pii-warning">
        <LvIcon name="shield" size={16} />
        <span>{PII_WARNING}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- upload row */

export function UploadRow({
  item,
  onRetry,
  onDismiss,
  onShowExisting,
}: {
  item: UploadItem;
  onRetry: () => void;
  onDismiss: () => void;
  onShowExisting?: (fileId: string) => void;
}) {
  return (
    <li
      className="cr-file cr-upload"
      data-testid="upload-row"
      data-state={item.state}
      data-code={item.code}
    >
      <span className="cr-file__icon" aria-hidden="true">
        <Icon
          name={
            item.state === 'uploading' ? 'upload' : item.state === 'duplicate' ? 'info' : 'alert'
          }
          size={18}
        />
      </span>
      <div className="cr-file__main">
        <p className="cr-file__name">{item.name}</p>
        <p className="cr-file__meta">
          <span>{formatBytes(item.size)}</span>
          <Dot />
          <span>{item.kind === 'syllabus' ? 'Syllabus' : 'Material'}</span>
        </p>
        {item.state === 'uploading' && (
          <div className="cr-file__bar">
            <ProgressBar value={item.pct / 100} label={`Uploading ${item.name}`} />
            <span className="cr-pct" data-testid="upload-pct">
              Uploading {item.pct}%
            </span>
          </div>
        )}
        {item.state === 'duplicate' && (
          <p className="cr-file__note" data-testid="upload-duplicate">
            Already in this course
            {item.existingFileId && onShowExisting ? (
              <>
                {' · '}
                <a
                  href={`#file-${item.existingFileId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onShowExisting(item.existingFileId!);
                  }}
                >
                  Show the existing file
                </a>
              </>
            ) : null}
          </p>
        )}
        {item.state === 'error' && (
          <p className="cr-file__err" role="alert" data-testid="upload-error">
            <Icon name="alert" size={16} />
            <span>{item.message ?? errorMessage(item.code)}</span>
          </p>
        )}
      </div>
      <div className="cr-file__actions">
        {item.state === 'error' &&
          item.code !== 'unsupported_type' &&
          item.code !== 'too_large' && (
            <Button
              variant="secondary"
              iconStart="arrow-right"
              onClick={onRetry}
              data-testid="upload-retry"
            >
              Retry
            </Button>
          )}
        <Button variant="ghost" onClick={onDismiss} data-testid="upload-dismiss">
          {item.state === 'uploading' ? 'Cancel' : 'Dismiss'}
        </Button>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- file row */

export function FileItem({
  file,
  canEdit,
  highlighted,
  onRetry,
  onRemove,
}: {
  file: FileRow;
  canEdit: boolean;
  highlighted?: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const terminal = isTerminal(file.status);
  const failed = file.status === 'failed';
  return (
    <li
      id={`file-${file.fileId}`}
      className="cr-file"
      data-testid="file-row"
      data-file-id={file.fileId}
      data-status={file.status}
      data-highlight={highlighted || undefined}
      tabIndex={-1}
    >
      <span className="cr-file__icon" aria-hidden="true" data-ext={extOf(file.name)}>
        <Icon name="file" size={18} />
      </span>
      <div className="cr-file__main">
        <p className="cr-file__name" title={file.name}>
          {file.name}
        </p>
        <p className="cr-file__meta">
          <Chip>{file.kind === 'syllabus' ? 'Syllabus' : 'Material'}</Chip>
          <span>{formatBytes(file.size)}</span>
          <Dot />
          <span>{file.pages === null ? 'pages unknown' : plural(file.pages, 'page')}</span>
          <Dot />
          <span className="cr-sha" title="First characters of the file fingerprint (SHA-256)">
            <span className="cr-vh">Fingerprint </span>
            {shortSha(file.sha256)}
          </span>
        </p>
        {!terminal && (
          <div className="cr-file__bar">
            <ProgressBar
              value={file.pct / 100}
              label={`${file.status === 'queued' ? 'Waiting to read' : file.status === 'parsing' ? 'Reading' : 'Indexing'} ${file.name}`}
            />
            <span className="cr-pct" data-testid="file-pct">
              {file.pct}%
            </span>
          </div>
        )}
        {failed && (
          <p
            className="cr-file__err"
            role="alert"
            data-testid="file-error"
            data-code={file.error?.code}
          >
            <Icon name="alert" size={16} />
            <span>{errorMessage(file.error?.code, file.error?.message)}</span>
          </p>
        )}
      </div>
      <div className="cr-file__side">
        <FileStatusChip status={file.status} />
        {canEdit && !confirming && (
          <div className="cr-file__actions">
            {failed && (
              <Button
                variant="secondary"
                iconStart="arrow-right"
                onClick={onRetry}
                data-testid="file-retry"
              >
                Retry
              </Button>
            )}
            <Button
              variant="ghost"
              iconStart="trash"
              onClick={() => setConfirming(true)}
              aria-label={`Remove ${file.name}`}
              data-testid="file-remove"
            >
              Remove
            </Button>
          </div>
        )}
        {canEdit && confirming && (
          <div className="cr-file__actions" role="group" aria-label={`Remove ${file.name}?`}>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
              data-testid="file-remove-confirm"
            >
              Remove file
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} autoFocus>
              Keep
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ panel */

export function FilesPanel({
  files,
  uploads,
  limits,
  canEdit,
  announce,
  highlight,
  onAdd,
  onRetryUpload,
  onDismissUpload,
  onShowExisting,
  onRetryFile,
  onRemoveFile,
}: {
  files: FileRow[];
  uploads: UploadItem[];
  limits: Limits;
  canEdit: boolean;
  announce: string;
  highlight: string | null;
  onAdd: (files: File[], kind: 'material' | 'syllabus') => void;
  onRetryUpload: (id: string) => void;
  onDismissUpload: (id: string) => void;
  onShowExisting: (fileId: string) => void;
  onRetryFile: (f: FileRow) => void;
  onRemoveFile: (f: FileRow) => void;
}) {
  const [liveMsg, setLiveMsg] = useState('');
  useEffect(() => setLiveMsg(announce), [announce]);
  return (
    <section className="cr-panel" aria-labelledby="cr-files-h" data-testid="files-panel">
      <header className="cr-panel__head">
        <div>
          <h2 id="cr-files-h" className="cr-panel__title">
            Files
          </h2>
          <p className="cr-muted">
            {plural(files.length, 'file')} of {limits.maxFilesPerCourse}
          </p>
        </div>
      </header>
      {canEdit ? (
        <DropZone limits={limits} onFiles={onAdd} />
      ) : (
        <Notice tone="info">
          You can read these files but only the person who added them can change them.
        </Notice>
      )}
      <p className="cr-vh" role="status" aria-live="polite" data-testid="files-live">
        {liveMsg}
      </p>
      {uploads.length + files.length === 0 ? (
        <p className="cr-muted cr-nofiles" data-testid="files-empty">
          No files yet. Add a syllabus or lecture PDFs and Squad reads them in about a minute.
        </p>
      ) : (
        <ul className="cr-files">
          {uploads.map((u) => (
            <UploadRow
              key={u.id}
              item={u}
              onRetry={() => onRetryUpload(u.id)}
              onDismiss={() => onDismissUpload(u.id)}
              onShowExisting={onShowExisting}
            />
          ))}
          {files.map((f) => (
            <FileItem
              key={f.fileId}
              file={f}
              canEdit={canEdit}
              highlighted={highlight === f.fileId}
              onRetry={() => onRetryFile(f)}
              onRemove={() => onRemoveFile(f)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
