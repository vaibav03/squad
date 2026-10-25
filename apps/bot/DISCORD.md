# Discord fallback transport

Use when iMessage cannot read text on this Mac. Same router, policy and Skills; nothing else changes.

1. https://discord.com/developers/applications > New Application > Bot. Copy the bot token into `.env` as `DISCORD_TOKEN=...` (never commit it).
2. Bot tab > Privileged Gateway Intents > enable **Message Content Intent**.
3. OAuth2 > URL Generator: scopes `bot`; permissions View Channels, Send Messages, Attach Files, Read Message History. Open the URL and invite the bot to a test server.
4. Map students to Discord user ids (Discord > Settings > Advanced > Developer Mode, then right-click a user > Copy User ID). In `apps/bot/fixtures/students.json` set `"handle": "discord:<userId>"`. Unknown users become `s_<last4 of id>`.
5. `TRANSPORT=discord pnpm --filter @squad/bot dev`. Mention the bot (`@Cubbie`) or write `cubbie, ...`; DMs always reach it. Pings are disabled in everything the bot sends.
