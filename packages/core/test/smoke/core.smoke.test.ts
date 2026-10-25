import { expect, it } from 'vitest';
import { FakeLlm, assertNoLeak, parseReplay, VillageEventSchema } from '../../src';
import { openMemoryDb } from '../../src/node';
import sample from '../../fixtures/sample-replay.json';

it('core smoke: sample replay validates, no sentinel leaks, fake llm + db work', async () => {
  const script = parseReplay(sample);
  script.events.forEach((e) => VillageEventSchema.parse(e.event));
  assertNoLeak(script.events.map((e) => e.event));
  expect((await new FakeLlm().complete({ messages: 'hi' })).text).toBeTruthy();
  expect(openMemoryDb().prepare('select 1 as x').get()).toEqual({ x: 1 });
});
