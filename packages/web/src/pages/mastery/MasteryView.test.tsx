// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MasteryView } from './MasteryView';
import { masteryData } from './fixtures';

afterEach(cleanup);

describe('MasteryView', () => {
  it('hides the Concept/You table for a chapter with no concepts', () => {
    const data = {
      ...masteryData,
      chapters: [{ ...masteryData.chapters[0]!, concepts: [] }, masteryData.chapters[1]!],
    };
    render(<MasteryView status="ready" connection="live" data={data} />);
    expect(screen.getAllByRole('columnheader', { name: 'Concept' })).toHaveLength(1);
  });
});
