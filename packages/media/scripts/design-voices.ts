// Designs and saves one ElevenLabs voice per persona profile that lacks a saved voiceId.
// Usage: pnpm --filter @squad/media exec tsx scripts/design-voices.ts [key ...]
// Consumes plan credits: run once, commit packages/media/src/voices/saved-voices.json.
import { createAudioServices } from '../src/factory';

const keys = process.argv.slice(2);
const a = createAudioServices();
const created = await a.voices.ensureProfileVoices(keys.length ? keys : undefined);
console.log(JSON.stringify({ created, saved: a.store.all() }, null, 2));
