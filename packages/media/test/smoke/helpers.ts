export { FakeLlm } from '@squad/core';
import type { Config } from '@squad/core/node';
export const loadConfigLike = (): Config => ({
  geminiModels: {},
  hubBaseUrl: 'http://localhost:1',
  internalEventsSecret: 'x',
  dbPath: ':memory:',
  live: false,
});
