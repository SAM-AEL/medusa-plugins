# Changelog — @sam-ael/medusa-plugin-whatsapp

## 2.0.0 (2026-10-16)

- No breaking API changes. This major aligns the version with the rest of the monorepo after the 2.0.0 security-hardening release.
- Regenerated the Mikro-ORM snapshot to drop the stale `access_token` column (removed from the model in an earlier migration, `Migration20260408090000`).
- Packaging: `LICENSE` and `README.md` are now included in the published tarball.
