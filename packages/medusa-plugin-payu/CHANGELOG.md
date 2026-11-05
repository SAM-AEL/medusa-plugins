# Changelog — @sam-ael/medusa-plugin-payu

## 2.0.0 (2026-10-16) — Security hardening (breaking)

- **Breaking:** Zero/negative amounts are rejected (`amount <= 0`). Previously `0.00` passed validation.
- **Breaking:** `REDIS_URL` is required in production. The provider throws at startup without it — webhook replay protection must not silently degrade to per-process memory.
- **Breaking:** `refundPayment` requires Medusa's stable `context.idempotency_key`; Redis atomically reserves the PayU token and refund balance before network calls. Reusing a key with another amount is rejected. Ambiguous/non-success outcomes stay reserved and require dashboard reconciliation; pending keys are never resubmitted automatically.
- Production webhook replay protection fails closed on Redis outages instead of falling back to per-process memory. Redis is required for production PayU.
- `STOREFRONT_URL` must be a valid absolute `https://` URL in production (parsed via `new URL()`, origin-only).
- All PayU hash inputs (`firstname`, `email`, `udf1`, `udf2`) are sanitized like `productinfo` (strip `|`/newlines, trim, cap); email format-checked.
- Webhook fields are type-guarded before hashing; gateway response bodies are stripped from errors (status only); logs carry messages, not full errors.
- Redis client is a reused singleton instead of connect/disconnect per webhook.
