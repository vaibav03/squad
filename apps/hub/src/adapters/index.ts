import type { Ports } from '../ports';
import type { HubDeps } from '../types';
import { createStubBrain } from './stub-brain';
import { createStubCall } from './stub-call';
import { createStubMedia } from './stub-media';
import { createStubQuiz } from './stub-quiz';

/** In-memory, deterministic stubs. Brain and media leads replace these through `createHub({ ports })`. */
export function createStubPorts(deps: HubDeps): Ports {
  return {
    quiz: createStubQuiz(),
    call: createStubCall(),
    brain: createStubBrain((student) => {
      const sq = deps.directory.squadOf(student);
      return sq ? (deps.directory.squad(sq)?.members ?? []) : [];
    }),
    media: createStubMedia(),
  };
}
