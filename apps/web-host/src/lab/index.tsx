import { createElement, lazy, Suspense, type ComponentType } from 'react';
import { Link, type RouteObject } from 'react-router-dom';
import { EmptyState, Page, Skeleton, type LabMeta } from '@squad/web';

const metaModules = import.meta.glob<{ meta: LabMeta }>('./*/meta.ts', { eager: true });
const pageModules = import.meta.glob<{ default: ComponentType }>('./*/index.tsx');

export interface LabEntry extends LabMeta { dir: string }

export const labEntries: LabEntry[] = Object.entries(metaModules)
  .map(([file, m]) => ({ ...m.meta, dir: file.split('/')[1]! }))
  .sort((a, b) => a.title.localeCompare(b.title));

function LabHost({ dir }: { dir: string }) {
  const loader = pageModules[`./${dir}/index.tsx`];
  if (!loader) return createElement(EmptyState, { title: 'Lab page missing', body: `lab/${dir}/index.tsx has no default export.`, icon: 'alert' });
  const Lazy = lazy(loader);
  return (
    <Suspense fallback={<Skeleton shape="block" height={320} />}>
      <Lazy />
    </Suspense>
  );
}

export function LabsIndex() {
  return (
    <Page title="Labs" eyebrow="Developer" width="narrow">
      {labEntries.length === 0 ? (
        <EmptyState icon="sparkle" title="No lab pages yet" body="Lab pages register themselves: add lab/<name>/meta.ts and lab/<name>/index.tsx." />
      ) : (
        <ul className="sq-labs">
          {labEntries.map((l) => (
            <li key={l.path}>
              <Link to={`/${l.path}`} className="sq-labs__link">
                <strong>{l.title}</strong>
                {l.description ? <span>{l.description}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export const labRoutes: RouteObject[] = [
  { path: '/__labs', element: <LabsIndex /> },
  ...labEntries.map((l) => ({ path: `/${l.path}`, element: <LabHost dir={l.dir} /> }) satisfies RouteObject),
];
