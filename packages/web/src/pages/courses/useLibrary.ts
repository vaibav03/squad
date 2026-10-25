import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useEventFeed, useLiveConfig } from '../../overlays/kit';
import { createHttpApi, HubError, type LibraryApi } from './api';
import { createMockApi } from './mock';
import { applyProgress, errorMessage, isTerminal, precheckFile } from './model';
import type { CourseDetail, CourseSummary, FileRow, IngestProgress, Limits } from './types';
import { DEFAULT_LIMITS } from './model';

export type LoadStatus = 'loading' | 'ready' | 'error' | 'offline' | 'missing';

const ApiCtx = createContext<LibraryApi | null>(null);
export function LibraryApiProvider({ api, children }: { api: LibraryApi; children: ReactNode }) {
  return createElement(ApiCtx.Provider, { value: api }, children);
}
export function useLibraryApi(): LibraryApi {
  const api = useContext(ApiCtx);
  if (!api) throw new Error('useLibraryApi outside LibraryApiProvider');
  return api;
}

/** One api per mounted page: the hub in live mode, local state (with simulated ingest) otherwise. */
export function useCreateApi(): LibraryApi {
  const cfg = useLiveConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl;
  const api = useMemo(
    () => (live ? createHttpApi({ hubUrl: cfg.hubUrl!, token: cfg.token }) : createMockApi()),
    [live, cfg.hubUrl, cfg.token],
  );
  useEffect(
    () => () => {
      if ('dispose' in api && typeof api.dispose === 'function') api.dispose();
    },
    [api],
  );
  return api;
}

export function classify(e: unknown): 'offline' | 'error' | 'missing' {
  if (e instanceof HubError) {
    if (e.status === 404) return 'missing';
    if (e.code === 'offline') return 'offline';
  }
  return typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error';
}

/* --------------------------------------------------------------- course list */

export function useCourseList(api: LibraryApi) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const have = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent || !have.current) setStatus('loading');
      try {
        const r = await api.listCourses();
        setCourses(r.courses);
        setLimits(r.limits);
        have.current = true;
        setStatus('ready');
      } catch (e) {
        if (silent && have.current) return;
        setStatus(classify(e) === 'offline' ? 'offline' : 'error');
      }
    },
    [api],
  );
  useEffect(() => {
    void load(true);
  }, [load]);

  const ingesting = courses.some((c) => c.status === 'ingesting');
  useEffect(() => {
    if (!ingesting) return;
    const t = setInterval(() => void load(true), 2500);
    return () => clearInterval(t);
  }, [ingesting, load]);

  useEffect(() => {
    const on = () => void load(true);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [load]);

  return {
    courses,
    limits,
    status,
    reload: () => load(false),
    refresh: () => load(true),
    setCourses,
  };
}

/* -------------------------------------------------------------- course detail */

export function useCourseDetail(api: LibraryApi, id: string) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [announce, setAnnounce] = useState('');
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setStatus('loading');
      try {
        const c = await api.getCourse(id);
        if (idRef.current !== id) return;
        setCourse(c);
        setStatus('ready');
      } catch (e) {
        if (silent) return;
        setStatus(classify(e));
      }
    },
    [api, id],
  );
  useEffect(() => {
    setCourse(null);
    void load(false);
  }, [load]);

  const noteFile = useCallback((f: FileRow, prev?: FileRow) => {
    if (prev && prev.status !== f.status) {
      if (f.status === 'ready') setAnnounce(`${f.name} is ready`);
      else if (f.status === 'failed') setAnnounce(`${f.name} could not be read`);
    }
  }, []);

  const courseRef = useRef<CourseDetail | null>(null);
  courseRef.current = course;

  /** Fold one file row (poll result or feed event) into the course; refetch once it turns terminal. */
  const applyRow = useCallback(
    (row: FileRow | IngestProgress) => {
      const c = courseRef.current;
      if (!c) return;
      const fid = 'fileId' in row ? row.fileId : '';
      const prev = c.files.find((f) => f.fileId === fid);
      if (!prev) return;
      const files =
        'name' in row
          ? c.files.map((f) => (f.fileId === fid ? row : f))
          : applyProgress(c.files, row);
      if (files === c.files) return;
      const next = files.find((f) => f.fileId === fid)!;
      noteFile(next, prev);
      const updated = { ...c, files };
      courseRef.current = updated;
      setCourse(updated);
      if (isTerminal(next.status) && !isTerminal(prev.status)) void load(true);
    },
    [load, noteFile],
  );
  const onProgress = applyRow;

  // live progress over the kit's event feed (x.ingest.progress); mock mode has no feed, polling covers it
  useEventFeed<IngestProgress>(
    {
      recorded: [],
      live: {
        parse: (raw) => {
          if (!raw || typeof raw !== 'object') return null;
          const o = raw as Record<string, unknown>;
          if (o.t !== 'x.ingest.progress' || typeof o.fileId !== 'string') return null;
          const s = o.status;
          const status =
            s === 'queued' ||
            s === 'parsing' ||
            s === 'embedding' ||
            s === 'ready' ||
            s === 'failed'
              ? s
              : 'parsing';
          return { fileId: o.fileId, pct: typeof o.pct === 'number' ? o.pct : 0, status };
        },
      },
    },
    onProgress,
  );
  useEffect(() => api.onIngest?.(onProgress), [api, onProgress]);

  // 1 s polling while any file is not terminal
  const activeIds = (course?.files ?? [])
    .filter((f) => !isTerminal(f.status))
    .map((f) => f.fileId)
    .join(',');
  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(',');
    let stopped = false;
    const t = setInterval(() => {
      for (const fid of ids) {
        api.getFile(fid).then(
          (row) => {
            if (!stopped) applyRow(row);
          },
          () => undefined,
        );
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [activeIds, api, applyRow]);

  useEffect(() => {
    const on = () => void load(true);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [load]);

  return {
    course,
    status,
    announce,
    setCourse,
    reload: () => load(false),
    refresh: () => load(true),
  };
}

/* -------------------------------------------------------------------- uploads */

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: 'material' | 'syllabus';
  state: 'uploading' | 'error' | 'duplicate';
  pct: number;
  code?: string;
  message?: string;
  existingFileId?: string;
}

let uploadSeq = 0;

export function useUploads(opts: {
  api: LibraryApi;
  courseId: string;
  limits: Limits;
  existingCount: number;
  onUploaded: () => void;
}) {
  const { api, courseId, limits, onUploaded } = opts;
  const [items, setItems] = useState<UploadItem[]>([]);
  const handles = useRef(new Map<string, { abort: () => void }>());
  const countRef = useRef(opts.existingCount);
  countRef.current = opts.existingCount;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const doneRef = useRef(onUploaded);
  doneRef.current = onUploaded;

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }, []);

  const start = useCallback(
    (item: UploadItem) => {
      patch(item.id, { state: 'uploading', pct: 0, code: undefined, message: undefined });
      const h = api.uploadFile(courseId, item.file, item.kind, (pct) => patch(item.id, { pct }));
      handles.current.set(item.id, h);
      h.promise.then(
        () => {
          handles.current.delete(item.id);
          setItems((xs) => xs.filter((x) => x.id !== item.id));
          doneRef.current();
        },
        (e: unknown) => {
          handles.current.delete(item.id);
          if (e instanceof HubError && e.code === 'aborted') return;
          const code = e instanceof HubError ? e.code : 'network';
          if (code === 'duplicate') {
            patch(item.id, {
              state: 'duplicate',
              code,
              message: 'Already in this course',
              ...(e instanceof HubError && e.extra.fileId
                ? { existingFileId: e.extra.fileId }
                : {}),
            });
          } else patch(item.id, { state: 'error', code, message: errorMessage(code) });
        },
      );
    },
    [api, courseId, patch],
  );

  const add = useCallback(
    (files: File[], kind: 'material' | 'syllabus' = 'material') => {
      let pending = 0;
      const fresh: UploadItem[] = [];
      for (const file of files) {
        const id = `u${++uploadSeq}`;
        const base: UploadItem = {
          id,
          file,
          name: file.name,
          size: file.size,
          kind,
          state: 'uploading',
          pct: 0,
        };
        const pre = precheckFile(file, limitsRef.current, {
          fileCount: countRef.current + pending,
        });
        if (pre) fresh.push({ ...base, state: 'error', code: pre.code, message: pre.message });
        else {
          pending += 1;
          fresh.push(base);
        }
      }
      setItems((xs) => [...fresh, ...xs]);
      for (const f of fresh) if (f.state === 'uploading') start(f);
    },
    [start],
  );

  const retry = useCallback(
    (id: string) => {
      const it = items.find((x) => x.id === id);
      if (!it) return;
      const pre = precheckFile(it.file, limitsRef.current, { fileCount: countRef.current });
      if (pre) {
        patch(id, { state: 'error', code: pre.code, message: pre.message });
        return;
      }
      start(it);
    },
    [items, patch, start],
  );
  const dismiss = useCallback((id: string) => {
    handles.current.get(id)?.abort();
    handles.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  useEffect(
    () => () => {
      for (const h of handles.current.values()) h.abort();
      handles.current.clear();
    },
    [],
  );
  return { items, add, retry, dismiss };
}
