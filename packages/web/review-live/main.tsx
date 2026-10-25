import { StrictMode, useEffect, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../src/styles/index.css';
import type { GalleryStory } from '../src/overlays/kit';

const modules = import.meta.glob<{ stories: GalleryStory[] }>(
  '../src/{overlays,pages/ledger,pages/trip,pages/mastery}/gallery.tsx',
  {
    eager: true,
  },
);
const stories = Object.values(modules).flatMap((m) => m.stories);

function Shell({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function App() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const id = q.get('story');
  const theme = q.get('theme') ?? 'dark';
  const calm = q.get('calm') === '1';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (calm) document.documentElement.dataset.calm = 'true';
  }, [theme, calm]);
  const story = stories.find((s) => s.id === id);
  if (!story) {
    return (
      <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <h1>web-live stories ({stories.length})</h1>
        <ul>
          {stories.map((s) => (
            <li key={s.id}>
              <a href={`?story=${s.id}`}>{s.id}</a> <span style={{ opacity: 0.6 }}>{s.title}</span>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  return (
    <Shell>
      <div id="story-root" style={{ minHeight: '100dvh', position: 'relative' }}>
        {story.render()}
      </div>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
