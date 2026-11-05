# Changelog — @sam-ael/medusa-plugin-discord

## 2.0.0 (2026-10-16) — Security hardening (breaking)

- **Breaking:** `GET /admin/discord/mappings` no longer returns `webhook_url`. Responses carry `masked_url` (`…last4` of the token) instead. The full bearer URL never leaves the server.
- **Breaking:** Updating a mapping requires re-entering `webhook_url` (stored secret is hidden). The admin UI prompts for re-entry when editing.
- **Breaking:** New mappings default to `is_active: false`; a successful `POST /admin/discord/verify` enables them. Direct API activation is rejected, and the admin UI routes enabling through Test.
- **Breaking:** `event_name` must be a supported event (`DISCORD_EVENTS`); unknown values are rejected with 400. `is_active` must be a boolean.
- **Breaking:** Default order/customer embeds redact name, email, and phone. Opt in with `DISCORD_INCLUDE_PII=true` (private staff channels only).
- `POST /admin/discord/verify` is rate-limited (5/min per mapping) and honors Discord 429s; failures return a generic message without upstream bodies.
- Tracking/thumbnail/avatar URLs must be `https:`; markdown link targets escaped; custom embeds length-capped (title 256 / description 4096 / 25 fields / footer 2048).
- Error logs carry status/message only — no payload reflection, no webhook URLs.
