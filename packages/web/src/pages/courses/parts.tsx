import { Chip, Icon } from '../../primitives';
import {
  courseStatusView,
  fileStatusView,
  masteryView,
  roleLabel,
  roleTone,
  visibilityLabel,
} from './model';
import type { ChapterRow, CourseRole, CourseStatus, IngestStatus, Visibility } from './types';

/** Five CSS pips. Decoration only: the word next to it carries the meaning. */
export function Pips({ filled, word }: { filled: number; word: string }) {
  return (
    <span className="cr-pips" data-word={word} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= filled || undefined} />
      ))}
    </span>
  );
}

/** Word plus pip, always the viewer's own box. */
export function MasteryTag({ mastery }: { mastery: ChapterRow['mastery'] }) {
  const v = masteryView(mastery);
  return (
    <span className="cr-mastery" data-word={v.word} title={`Your mastery: ${v.label}`}>
      <Pips filled={v.filled} word={v.word} />
      <span className="cr-mastery__word">{v.label}</span>
      <span className="cr-vh">, your mastery of this chapter</span>
    </span>
  );
}

export function CourseStatusChip({ status }: { status: CourseStatus }) {
  const v = courseStatusView(status);
  return (
    <span data-testid="course-status" data-status={status}>
      <Chip tone={v.tone} icon={v.icon}>
        {v.label}
      </Chip>
    </span>
  );
}

export function FileStatusChip({ status }: { status: IngestStatus }) {
  const v = fileStatusView(status);
  return (
    <span data-testid="file-status" data-status={status}>
      <Chip tone={v.tone} icon={v.icon}>
        {v.label}
      </Chip>
    </span>
  );
}

export function RoleChip({ role }: { role: CourseRole }) {
  return (
    <span data-testid="course-role" data-role={role}>
      <Chip
        tone={roleTone(role)}
        icon={role === 'owner' ? 'user' : role === 'squad' ? 'users' : 'book'}
      >
        {roleLabel(role)}
      </Chip>
    </span>
  );
}

export function VisibilityChip({ visibility }: { visibility: Visibility }) {
  return (
    <span data-testid="course-visibility" data-visibility={visibility}>
      <Chip icon={visibility === 'private' ? 'lock' : visibility === 'squad' ? 'users' : 'eye'}>
        {visibilityLabel(visibility)}
      </Chip>
    </span>
  );
}

export function Meta({ children }: { children: React.ReactNode }) {
  return <span className="cr-meta">{children}</span>;
}

export function Dot() {
  return (
    <span className="cr-dot" aria-hidden="true">
      ·
    </span>
  );
}

export { Icon };
