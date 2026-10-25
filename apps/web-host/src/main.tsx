import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Agentation } from 'agentation';
import { ErrorBoundary, FailureState, RootWatchdog } from '@squad/web';
import '@squad/web/styles.css';
import './host.css';
import { createRouter } from './router';

const router = createRouter();

// A direct load of the village is a waterfall (app -> account -> page chunk -> engine chunk). Start the engine chunk
// now, in parallel with signing in, so a slow connection waits for the longest download instead of their sum.
if (location.pathname.startsWith('/squad/village'))
  void import('@squad/village').catch(() => undefined);

// Never leave an empty root: a crash anywhere in the page host shows an error state with Retry, and the dev-only
// feedback toolbar sits in its own boundary so a failure there cannot take the app down.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(_, retry) => (
        <FailureState
          title="Squad hit a problem"
          body="The app could not be shown."
          onRetry={retry}
        />
      )}
    >
      <RouterProvider router={router} />
      <RootWatchdog />
    </ErrorBoundary>
    {import.meta.env.DEV && (
      <ErrorBoundary fallback={() => null}>
        <Agentation endpoint="http://localhost:4747" />
      </ErrorBoundary>
    )}
  </StrictMode>,
);

// Tell the static boot guard in index.html that the app took over.
requestAnimationFrame(() => window.dispatchEvent(new Event('squad:booted')));
