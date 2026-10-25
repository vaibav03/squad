# Agent aliases and typed mentions

One alias table and one parser (`packages/core/src/mentions.ts`) are shared by the bot router, the hub chat engine (web chat), the iMessage bridge (`apps/hub/src/imessage`) and the web composer autocomplete (`packages/web/src/components/mention-autocomplete`).

## Alias table

Cubbie is the default and first entry. `@cubbie` and `@cubbi` (any case) both mean Cubbie.

| Alias | Kind | Answers as | What it does |
| --- | --- | --- | --- |
| `@cubbie`, `@cubbi`, `@squad` | router | Cubbie | Your study buddy. Picks the right skill for the message. |
| `@tutor`, `@teacher` | persona | Tutor | Explains the idea simply, then checks you got it. |
| `@skeptic` | persona | Skeptic | Pokes holes and asks for evidence. |
| `@planner` | persona | Planner | Steps, order and dates. Plan intents start the flows: `@planner plan a trip to Cabo` (any `@planner ... trip ...`) starts the trip flow, `@planner study plan for the exam on Nov 12` starts the study-plan flow; other messages get the persona answer. |
| `@examiner` | persona | Examiner | Asks what a test would ask. |
| `@chair` | persona | Chair | Keeps order, calls decisions. |
| `@council` | council | Cubbie | Convenes the council (the `council` skill). |
| `@advisor`, `@chill`, `@grind`, `@chairman` | persona | Round Table member | Balanced, rest-first, max-hours, and the deciding voice. |
| `@quiz` | skill | Cubbie | Runs the `quiz` skill. |
| `@feynman` | skill | Cubbie | Runs `feynman`. |
| `@stepdiff` | skill | Cubbie | Runs `stepDiff`. |
| `@podcast`, `@explainer` | skill | Cubbie | Media skills (only when media is configured). |
| `@debate`, `@oracle`, `@rubric`, `@devilta` | skill | Cubbie | The matching brain skills. |
| `@studyplan`, `@plan` | skill | Cubbie | Study plan. |
| `@discuss`, `@live` | skill | Cubbie | Live agent discussion. |

A skill alias runs its skill even when its own score would be low: `@quiz chapter 6` is rewritten to `@cubbie quiz me chapter 6` for the skill.

## Parser rules (`parseMentions(text)`)

- Word-boundary and case-insensitive: `@cubbi`, `@Cubbi`, `@CUBBIE` all match.
- Punctuation after the word is fine: `@cubbi,` `@cubbi:` `@cubbi?` `@cubbie!` `@cubbie.`. Leading, middle and trailing mentions all work.
- Not a mention: `me@cubbi.com`, `user@host`, `a+b@x`, `@@cubbie`, `@cubbie-bot`, `@cubbi.fan`, `path/@cubbie`.
- Never inside inline code, fenced code, a `"quote"` or curly quote, a `>` block quote, a markdown link, or a URL. An unclosed quote or backtick does not hide a mention.
- Near-misses (`@cubbies`, `@squadron`, `@cub`) are silent: not a mention and not an unknown tag. Plain `cubbie` without `@` is silent too (except the classic `hey cubbie ...`, `cubbie, ...`, `cubbie:` and a lone `cubbie`).
- Unknown `@word` yields `unknownMention`.
- Result: `{ mentions (distinct agents, in order), unknownMention, rest }`. `rest` is the text without the mentions.

## Router behavior

- `@planner` plan intents (`plannerIntent` in `packages/core/src/mentions.ts`): `trip` in the text starts the trip flow (the hub's trip chat handler runs before the bot, `apps/hub/src/trips/chat.ts`, so `@planner trip to Lisbon in June` needs no planning verb); `study plan ...` or `plan the midterm/final/exam` runs the `sharedPlan` skill in the bot router. If a message names both, "study plan" wins. Anything else addressed to `@planner` still gets the persona answer.
- An addressed agent always replies (it overrides the speaking-policy score). Persona replies are prefixed with the persona name.
- Several tags answer in order, one reply each, capped at 3.
- A bare `@cubbi` replies "What do you need?".
- `@council` and skill aliases run that skill; if the skill is not registered the reply says it is not available.
- `@cubbie <text>` alone keeps the classic scored path (recorded decision with scores).
- An unknown tag is only helped when it is probably a mistake, not a person. The help goes out when the word is a typo of an alias (edit distance 2 for aliases of 6+ letters, 1 for shorter ones: `@tutr`, `@cubie`, `@skeptik`), or the whole message is just the tag (`@zork`). It never goes out when the word is the first, last or full name of a member of the squad/thread (the hub passes the squad directory; the bot also uses its roster). `@jamie are you coming` and `@priya can you send notes` are always silent, member or not. Silent tags do not use up the rate limit.
- The help goes to the sender only. In a group it goes to the sender's DM and the group only sees `Sent you a DM`. Rate limit: one help per sender per minute (silent after that). In a DM the help is the reply.
- Banter without a tag stays silent (the 50-line banter suite plus 30 near-miss lines).
- Privacy: persona and skill replies only see the tagged message. Help text lists public agent names only and never echoes more than 24 sanitised characters of the unknown tag. DM-only content stays in DMs.
- Inspector: each addressed agent emits an `agent.state` (`studying`, then `idle`) with `thought: "Addressed @tutor (Tutor)"` and `work.skill: "tutor"`. No new event kinds.

## iMessage

The bridge reuses the same parser: an alias in a bound group is relayed to the squad chat and answered in the same group; an unknown alias gets the help DM to the sender's 1:1 (and `Sent you a DM` in the group); a mention in an unbound group gets the join hint. `@cubbi join <code>` and `@cubbi who is linked` work like `@cubbie`.

## Web composer autocomplete

`packages/web/src/components/mention-autocomplete` is standalone and not wired into `pages/chat` yet (that page is being fixed elsewhere). Integration point: render `<MentionAutocomplete text caret onSelect />` above the textarea and call `mentionKey(e.key, text, caret, index)` from `onKeyDown`. Cubbie is the first row for `@`, `@cub` and `@cubbi`. The page's own `mentionsBot` regex in `pages/chat/model.ts` should later be replaced by `parseMentions(text).mentions.length > 0`.
