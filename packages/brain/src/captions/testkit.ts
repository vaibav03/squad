import type { FakeLlm, VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createContextProvider } from '../experts/context';
import { makeKit } from '../experts/testkit';
import { createCaptionPipeline } from './index';

export async function captionKit(llm: FakeLlm) {
  const k = await makeKit(llm);
  const contexts = createContextProvider(k.store, llm, { minCacheChars: 10 });
  const pipeline = createCaptionPipeline({ store: k.store, contexts, llm, emit: k.emit, db: k.db });
  return { ...k, contexts, pipeline };
}
export type { VillageEvent };
export { openMemoryDb };
