# Changelog — @sam-ael/medusa-plugin-mailer

## 2.0.0 (2026-10-16) — Security hardening (breaking)

- **Breaking:** Notification provider `send()` and manual-send now reject invalid `to`/`from` addresses with 400 instead of passing them to SMTP.
- **Breaking:** `POST /admin/mailer/mappings/:id` enforces the `MAILER_EVENTS` allowlist (same as create); arbitrary `event_name` values are rejected.
- Manual-send `variables` are capped via `normalizeTemplateVariables` (20 vars, allowlisted keys, 2000 chars) — same as mapping path.
- `GET /admin/mailer/templates` no longer falls back outside the resolved directory and no longer discloses the server `directory` path.
- SMTP verify/send failures return generic messages; recipient addresses are masked in logs.
- Explicit admin auth middleware (`src/api/middlewares.ts`) instead of relying on the framework default.
- Dependency floor: `nodemailer >=6.10.1 <7`.
