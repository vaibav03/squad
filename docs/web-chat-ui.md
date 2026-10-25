# Web chat UI (packages/web/src/pages/chat)

Frontend for the wire contract in `docs/chat-api.md`. Route `/squad/chat` (primary nav; Trip moved to the phone "More" sheet to keep four primaries), plus a compact dock on the village page.

- `index.tsx` page (default export, `?c=<chatId>` deep link). Dev only: `?demo=fixtures[&fx=empty|real|loading|error|expired]` runs against the fake api.
- `api.ts` `ChatApi` interface + `createChatApi({hubUrl, token})` (zod-parsed with `@squad/core`, fixed user-safe error copy, SSE with stream token, reconnect with a fresh token and the last seq, `chat.resync` refetch). Status is parsed leniently. Files load with the bearer token as `?st=`.
- `useChat.ts` state: status (re-fetched every 60 s and after each bot reply), chats, history, optimistic send with Retry/Remove, typing (45 s safety), unread (localStorage `squad.chat.seen.<me>`), quiz answered state (`squad.chat.quiz.<me>`).
- `model.ts` pure logic (grouping, day labels, citation markers, mentions, formatters); `fixtures.ts` realistic fake api.
- Quiz answers send `@cubbie <id>` in a group and `<id>` in a DM. Confirm options send the 1-based number to the DM.
- Test ids: `chat-list`, `chat-row-<chatId>`, `chat-thread`, `chat-message` (`data-sender-id`, `data-message-id`), `chat-composer-input`, `chat-send`, `chat-typing`, `chat-citation-chip`, `chat-citation-excerpt`, `chat-quiz-choice-<id>`, `chat-confirm-option-<n>`, `chat-privacy-badge`, `chat-demo-notice`, `chat-demo-label`, `chat-offline`, `chat-paused`, `chat-new-pill`, `chat-prompt`, `chat-file-input`, `chat-mention-<id>`, `chat-dock-open`, `chat-dock-close`, `chat-dock-unread`.
- Screenshots: `docs/design/shots/chat/ui-*.png` (fixtures) and `ui-real-*.png` (real hub).
