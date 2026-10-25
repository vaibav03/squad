import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Agentation } from 'agentation';
import '@squad/web/styles.css';
import './host.css';
import { createRouter } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={createRouter()} />
    {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
  </StrictMode>,
);
