import { test } from '../lib/helpers';

// J8: podcast / explainer card in chat (`@cubbie podcast ch2`, `@cubbie picture it ch2`).
// The bot side exists (apps/bot/src/skills/media.ts), but the chat UI that renders those cards lives on
// chat/web. That branch conflicts with qa/web in files the rooms work also touches (resilient.ts,
// status.ts), so it is not merged into e2e/rooms and this journey is skipped with a note.
test.skip('J8 podcast / explainer card in chat: blocked, chat/web not merged into e2e/rooms', async () => {
  /* see the comment above; re-enable once chat/web merges cleanly */
});
