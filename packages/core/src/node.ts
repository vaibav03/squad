// Node-only entry (`@squad/core/node`): native/Node deps live here so the browser-safe main entry
// (`@squad/core`) can be imported by @squad/web and @squad/village.
export { openDb, openMemoryDb, migrate, CORE_SCHEMA } from './db';
export {
  loadConfig,
  describeConfig,
  findRepoRoot,
  ConfigSchema,
  type Config,
  type LoadConfigOptions,
} from './config';
export { GeminiLlm, DEFAULT_GEMINI_MODELS, type GeminiLlmOptions } from './llm/gemini';
