import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../primitives';
import { CourseDetailView } from './Detail';
import { SAMPLE_ID } from './fixtures';
import { Overview } from './Overview';
import { CreateCourseSheet } from './Sheets';
import { SourceHost } from './source';
import { LibraryApiProvider, useCourseList, useCreateApi } from './useLibrary';
import './courses.css';

/** /squad/courses/:courseId? Library overview, or one course's files, chapters, policy and catalogue. */
export default function CoursesPage() {
  const api = useCreateApi();
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const list = useCourseList(api);
  const [creating, setCreating] = useState(false);

  const create = useCallback(
    async (title: string) => {
      const c = await api.createCourse(title);
      setCreating(false);
      void list.refresh();
      toast({
        title: `Created ${c.title}`,
        body: 'Add your files next.',
        tone: 'ok',
        durationMs: 2500,
      });
      navigate(`/squad/courses/${encodeURIComponent(c.id)}`);
    },
    [api, list, navigate, toast],
  );

  return (
    <LibraryApiProvider api={api}>
      {courseId ? (
        <CourseDetailView
          api={api}
          id={courseId}
          limits={list.limits}
          onChanged={() => void list.refresh()}
        />
      ) : (
        <Overview
          status={list.status === 'missing' ? 'error' : list.status}
          courses={list.courses}
          onRetry={() => void list.reload()}
          onNew={() => setCreating(true)}
          onSample={() =>
            navigate(`/squad/courses/${list.courses.find((c) => c.sample)?.id ?? SAMPLE_ID}`)
          }
        />
      )}
      <CreateCourseSheet open={creating} onClose={() => setCreating(false)} onCreate={create} />
      <SourceHost />
    </LibraryApiProvider>
  );
}
