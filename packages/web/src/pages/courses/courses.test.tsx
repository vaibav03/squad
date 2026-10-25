// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../primitives';
import CoursesPage from './index';

afterEach(cleanup);

const app = (path: string) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/squad/courses/:courseId?" element={<CoursesPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );

describe('courses page (mock mode)', () => {
  it('lists courses with role chips, attribution and mastery words', async () => {
    app('/squad/courses');
    await waitFor(() => expect(screen.getAllByTestId('course-card').length).toBe(4));
    expect(screen.getByText('Introductory Statistics 2e, OpenStax, CC BY 4.0')).toBeTruthy();
    expect(screen.getAllByText('Sample').length).toBeGreaterThan(0);
    expect(screen.getAllByText('learning').length).toBeGreaterThan(0);
  });
  it('detail shows files, ingest states and the PII warning', async () => {
    app('/squad/courses/c_bio201_9fK2pQ');
    await waitFor(() => expect(screen.getAllByTestId('file-row').length).toBe(4));
    expect(screen.getByTestId('pii-warning').textContent).toContain("other people's private files");
    expect(screen.getByTestId('file-error').textContent).toMatch(/scan/i);
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
  });
  it('policy lines expose a citation chip when a source file is known', async () => {
    app('/squad/courses/c_bio201_9fK2pQ');
    await waitFor(() => expect(screen.getAllByTestId('file-row').length).toBe(4));
    const lines = screen.queryAllByTestId('policy-line');
    if (lines.length > 0)
      expect(screen.getAllByRole('button', { name: /^Source:/ }).length).toBeGreaterThan(0);
  });
  it('delete is gated on typing the title', async () => {
    app('/squad/courses/c_bio201_9fK2pQ');
    await waitFor(() => screen.getByTestId('delete-course'));
    fireEvent.click(screen.getByTestId('delete-course'));
    await waitFor(() => screen.getByTestId('delete-summary'));
    const btn = screen.getByTestId('delete-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('delete-title-input'), {
      target: { value: 'BIO 201: Cell Biology' },
    });
    expect(btn.disabled).toBe(false);
  });
  it('sample course cannot be deleted', async () => {
    app('/squad/courses/c_openstax_stats');
    await waitFor(() => screen.getByTestId('delete-reason'));
    expect((screen.getByTestId('delete-course') as HTMLButtonElement).disabled).toBe(true);
  });
  it('chapter rename works from the keyboard', async () => {
    app('/squad/courses/c_bio201_9fK2pQ');
    await waitFor(() => screen.getAllByTestId('chapter-rename'));
    fireEvent.click(screen.getAllByTestId('chapter-rename')[0]!);
    const input = screen.getByTestId('chapter-title-input');
    fireEvent.change(input, { target: { value: 'Cells, up close' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getAllByTestId('chapter-title')[0]!.textContent).toBe('Cells, up close'),
    );
  });
});

describe('planner catalogue panel', () => {
  it('shows code, title, credits, days, time, prerequisites and term for every row; no blanks', async () => {
    app('/squad/courses/c_bio201_9fK2pQ');
    const panel = await screen.findByTestId('catalogue-panel');
    const rows = panel.querySelectorAll('tbody tr');
    expect(rows.length).toBe(4);
    for (const tr of Array.from(rows)) {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent?.trim());
      expect(cells.length).toBe(7);
      expect(cells.every((c) => c && c.length > 0)).toBe(true);
    }
    expect(panel.textContent).toContain('BIO 201');
    expect(panel.textContent).toContain('MWF');
    expect(panel.textContent).toContain('09:00 to 09:50');
  });
});

describe('planner catalogue panel gaps', () => {
  it('renders "Missing days/time" instead of blank cells', async () => {
    const { CataloguePanel } = await import('./PanelsMisc');
    render(
      <CataloguePanel
        canImport={false}
        onImport={async () => undefined}
        catalogue={{
          sample: false,
          rows: [
            {
              code: 'CSL 101',
              title: 'Intro',
              credits: 3,
              days: '',
              start: '',
              end: '',
              location: '',
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('catalogue-gap').textContent).toContain('Missing days/time');
  });
});
