// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MasteryRedirect from './index';

afterEach(cleanup);
function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

describe('/squad/mastery', () => {
  it('redirects to the village with the mastery panel flag', () => {
    render(
      <MemoryRouter initialEntries={['/squad/mastery']}>
        <Routes>
          <Route path="/squad/mastery" element={<MasteryRedirect />} />
          <Route path="/squad/village" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where').textContent).toBe('/squad/village?mastery=1');
  });
});
