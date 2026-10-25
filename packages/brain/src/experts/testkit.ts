import type { VillageEvent } from '@squad/core';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCourseStore, ingestText } from '../ingest';

export const PAGE_MSE =
  'The mean squared error is the average of the squared differences between predictions and targets. The factor of 2 in the derivative comes from the power rule applied to the square.';
export const PAGE_BIAS =
  'Variance measures how much a model changes when the training set changes. Bias is the error from wrong assumptions in the learning algorithm.';
export const PAGE_SQL =
  'A relational database stores rows in tables. A primary key uniquely identifies each row in a table and cannot be null.';

export async function makeKit(llm: FakeLlm = new FakeLlm()) {
  const db = openMemoryDb();
  const store = createCourseStore(db);
  const deps = { store };
  await ingestText(deps, 'c', 'ch3-slides.pdf', [PAGE_BIAS, PAGE_MSE], {
    title: 'Loss functions and bias',
    chapter: 'ch3',
  });
  await ingestText(
    deps,
    'c',
    'ch5-slides.pdf',
    [PAGE_SQL, 'Joins combine rows from two tables that share a matching key column value.'],
    {
      title: 'Relational databases',
      chapter: 'ch5',
    },
  );
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => {
    events.push(e);
  };
  return { db, store, llm, events, emit };
}
