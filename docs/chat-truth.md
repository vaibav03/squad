# Chat truth

One vocabulary for "is this real?" lives in `packages/core/src/truth-labels.ts` (chat header, bubbles, council card, Home, Connections).

Long labels: `Live: answered by Gemini`, `Partly live`, `Practice mode: example answers, not real AI`, `Not set up yet`.

Header badge (transport + provider, plus any visible council content):

| Provider | Visible council | Badge |
| --- | --- | --- |
| live | none / live | Live provider |
| live | fixture | Live chat · Example council |
| live | degraded | Live chat · Degraded council |
| not answering, no key | none | Not set up |
| not answering, credits/error | none | Degraded |
| not answering | fixture | Fixture council |

Transport problems win: Signed out, Offline, Reconnecting, Connecting. Each message and card carries its own badge.

- The structured council card (`ChatCouncilCard`) is the canonical answer; the closing plain text (short form) is for iMessage/Discord and is not shown as a bubble on the web.
- Cards are a registry keyed by card type (`pages/chat/card-registry.tsx`); height is capped at ~40% of the thread (`--sqc-card-max`).
- Waiting: one `Cubbie is thinking…` per trigger message; after 8 s elapsed time and Retry; Retry re-sends the same `clientId` with `retryAnswer: true` (hub answers the same message once, never a second prompt).
- Redelivery: hub idempotent by (chat, sender, clientId); answers keyed by `replyTo`; the client hides duplicate answers per trigger.
