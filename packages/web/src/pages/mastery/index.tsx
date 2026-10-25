import { useEffect } from 'react';
import { useShell } from '../../shell/shell-context';
import { useParams } from 'react-router-dom';
import { MasteryView } from './MasteryView';
import { useMastery } from './useMastery';
import { COURSE_ID } from './fixtures';

/** /squad/mastery/:courseId? Own row plus the squad average (hidden under 3 members). */
export default function MasteryPage() {
  const { setTitle } = useShell();
  useEffect(() => setTitle('Mastery'), [setTitle]);
  const { courseId = COURSE_ID } = useParams();
  const m = useMastery(courseId);
  return (
    <MasteryView status={m.status} connection={m.connection} data={m.data} onRetry={m.retry} />
  );
}
