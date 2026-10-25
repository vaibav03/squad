// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusPage } from './StatusView';
import { sampleEmpty, sampleReal, sampleStatus } from './fixtures';
import {
  countLabel,
  explainDemo,
  formatDuration,
  parseAdminStatus,
  relTime,
  sparkPoints,
} from './model';

afterEach(cleanup);
const base = { sample: true, token: '', setToken: () => {}, refresh: () => {} };

describe('status model', () => {
  it('parses fixtures, rejects junk', () => {
    expect(parseAdminStatus(sampleStatus)).not.toBeNull();
    expect(parseAdminStatus({ nope: 1 })).toBeNull();
  });
  it('formats durations, times, hidden counts, sparklines', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(3700)).toBe('1 h 1 min');
    expect(relTime(1000 + 42_000, 1000)).toBe('in 42 s');
    expect(relTime(undefined, 0)).toBe('not scheduled');
    expect(countLabel(null)).toBe('Hidden');
    expect(sparkPoints([0, 0], 100, 40)).toContain(',');
    expect(sparkPoints([], 100, 40)).toBe('');
  });
  it('explains demo mode by reason', () => {
    expect(explainDemo(sampleStatus).why).toContain('402');
    expect(explainDemo(sampleReal).heading).toContain('real');
  });
});

describe('StatusPage', () => {
  it('shows demo mode, reason, next probe and the exact fix', () => {
    render(<StatusPage {...base} view="ready" data={sampleStatus} now={sampleStatus.now} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByTestId('llm-mode').textContent).toBe('Demo mode');
    expect(screen.getByTestId('next-probe').textContent).toBe('in 42 s');
    expect(screen.getAllByText(/Top up Gemini credits/).length).toBeGreaterThan(0);
    expect(screen.getByText('Down')).toBeTruthy();
    expect(screen.getAllByText('Hidden').length).toBe(1);
  });
  it('real model, empty, and non-ready states', () => {
    const { rerender } = render(
      <StatusPage {...base} view="ready" data={sampleReal} now={sampleReal.now} />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByTestId('llm-mode').textContent).toBe('Real model');
    rerender(<StatusPage {...base} view="ready" data={sampleEmpty} now={sampleEmpty.now} />);
    expect(screen.getByText(/No errors since/)).toBeTruthy();
    rerender(<StatusPage {...base} view="denied" now={0} />);
    expect(screen.getByText('Operators only')).toBeTruthy();
    rerender(<StatusPage {...base} view="error" now={0} />);
    expect(screen.getByText('Squad did not answer')).toBeTruthy();
    rerender(<StatusPage {...base} view="offline" now={0} />);
    expect(screen.getByText('You are offline')).toBeTruthy();
    rerender(<StatusPage {...base} view="loading" now={0} />);
    expect(screen.getByText('Loading status')).toBeTruthy();
  });
});
