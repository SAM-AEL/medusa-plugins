# Medusa Plugins Monorepo

Production-grade integration plugins, payment providers, and fulfillment services for **Medusa v2**.

[![Medusa v2](https://img.shields.io/badge/Medusa-v2.12.0+-blue.svg)](https://medusajs.com/)
[![Node.js](https://img.shields.io/badge/Node.js->=20.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#testing)

---

## Overview

This repository hosts a curated collection of official integration plugins and providers engineered specifically for the **Medusa v2 Framework**. Each package is built to production standards, adhering to Medusa's architectural paradigms (DML models, workflows, subscribers, custom providers, and Admin UI extensions) while incorporating enterprise-grade defensive security patterns.

### Packages

| Package | NPM | Type | Description | Target Medusa |
|---|---|---|---|---|
| [`@sam-ael/medusa-plugin-discord`](./packages/medusa-plugin-discord) | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-discord.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-discord) | Plugin | Real-time Discord notifications with dynamic embed editing per order | `^2.12.0` |
| [`@sam-ael/medusa-plugin-mailer`](./packages/medusa-plugin-mailer) | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-mailer.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-mailer) | Plugin & Provider | Event-driven transactional email via SMTP with admin template mapping and Notification Provider | `^2.12.0` |
| [`@sam-ael/medusa-plugin-payu`](./packages/medusa-plugin-payu) | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-payu.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-payu) | Payment Provider | PayU India redirect checkout, SHA-512 verification, underpayment protection & replay defense | `^2.12.0` |
| [`@sam-ael/medusa-plugin-shiprocket`](./packages/medusa-plugin-shiprocket) | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-shiprocket.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-shiprocket) | Fulfillment Provider & Plugin | Shiprocket fulfillment sync, AWB tracking, pickups, returns & order timeline widget | `^2.12.0` |
| [`@sam-ael/medusa-plugin-whatsapp`](./packages/medusa-plugin-whatsapp) | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-whatsapp.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-whatsapp) | Plugin | Meta WhatsApp Cloud API template notifications, event mapping & redacted audit logs | `^2.12.0` |

---

## Architecture & Engineering Standards

All packages in this repository strictly conform to the following core tenets:

1. **Medusa v2 Alignment**
   - **Data Modeling Layer (DML):** Custom database entities use `model.define(...)` with explicit index definitions matching generated MikroORM migrations.
   - **Workflows & Subscribers:** Long-running and asynchronous tasks are orchestrated using Medusa Workflows and the core Event Bus.
   - **Typed Authentication:** Store and admin endpoints leverage typed request extensions (`AuthenticatedMedusaRequest`) for actor resolution.
   - **Admin UI Extensions:** Built using `@medusajs/ui` with dual error envelope normalization (`res.ok` handling and structured JSON error parsing).

2. **Defensive Security**
   - **Constant-Time Verification:** Inbound webhook signatures and authentication tokens are verified using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
   - **Replay Protection:** Sensitive webhooks implement in-memory sliding-window deduplication to prevent duplicate execution of financial or tracking events.
   - **Prototype Pollution Guards:** Variable path resolvers validate against `__proto__`, `constructor`, and `prototype` traversal.
   - **Injection Prevention:** User-supplied content in notifications and emails is escaped against HTML, markdown, and platform-specific mention exploits.
   - **PII Redaction:** Transmission logs and debug outputs automatically mask credit card numbers, passwords, authorization tokens, and phone numbers.

3. **Peer Dependency Management**
   - All packages declare `@medusajs/framework` as a flexible peer dependency (`^2.12.0`), allowing host applications on any Medusa v2.12.0+ release to resolve dependencies without version conflicts.

---

## Repository Structure

```
medusa/
├── packages/
│   ├── medusa-plugin-discord/       # Discord webhook notifications & admin UI
│   ├── medusa-plugin-mailer/        # SMTP transactional mailer & notification provider
│   ├── medusa-plugin-payu/          # PayU India payment provider
│   ├── medusa-plugin-shiprocket/    # Shiprocket fulfillment provider & admin tracking widget
│   └── medusa-plugin-whatsapp/      # WhatsApp Cloud API notification engine & audit logging
├── scripts/
│   ├── run-tests.cjs                # Automated test runner across all packages
│   └── ts-loader.mjs                # TypeScript execution loader for native Node test runner
├── package.json                     # Monorepo workspaces manifest
└── README.md
```

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Package Manager**: `yarn` (version `4.x` recommended, or `npm` / `pnpm`)
- **Medusa Backend**: A working Medusa v2 project (`>= 2.12.0`)
- **Database**: PostgreSQL 14+

### Installing Workspace Dependencies

Clone the monorepo and install dependencies from the root directory:

```bash
git clone https://github.com/sam-ael/medusa-plugins.git
cd medusa-plugins
yarn install
```

---

## Testing

The monorepo includes comprehensive automated unit test suites covering security utilities, cryptographic hash calculations, input sanitization, rate limiters, and payload normalizers across all five packages.

Tests run using Node.js's native test runner (`node:test`) with real-time TypeScript transpilation:

```bash
# Run all test suites across the monorepo
yarn test

# Or execute the runner script directly
node scripts/run-tests.cjs
```

### Test Suite Coverage

- **`medusa-plugin-payu`**: Transaction ID generation, SHA-512 payment hash calculation, reverse response hash roundtrip, tampered payload rejection, `additionalCharges` hash handling, Indian phone normalization, and retryable HTTP status checks.
- **`medusa-plugin-discord`**: Webhook URL normalization and protocol validation, minor-to-major currency unit conversion, multi-currency formatting resilience, user/role mention neutralization, and event matrix verification.
- **`medusa-plugin-shiprocket`**: AWB format validation, retryable HTTP status codes, sliding-window rate limiting and reset behavior, and client IP resolution precedence.
- **`medusa-plugin-mailer`**: HTML entity escaping, safe URL protocol filtering (`http`, `https`, `mailto`), directory traversal prevention, prototype pollution guards, RFC-compliant email header sanitization, and plain-text stripping.
- **`medusa-plugin-whatsapp`**: Strict E.164 phone normalization, comprehensive PII log redaction, data path traversal security, and template variable extraction.

---

## Building Packages

To compile TypeScript source files across all packages:

```bash
yarn build
```

To run type checking across all workspace packages:

```bash
yarn typecheck
```

---

## Plugin Configuration Quick Reference

Below is an example `medusa-config.ts` integrating packages from this monorepo into a host Medusa v2 application:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    // PayU India Payment Provider
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@sam-ael/medusa-plugin-payu/providers/payu",
            id: "payu",
            options: {
              merchantKey: process.env.PAYU_MERCHANT_KEY,
              merchantSalt: process.env.PAYU_MERCHANT_SALT,
              environment: process.env.PAYU_ENVIRONMENT || "test",
            },
          },
        ],
      },
    },
    // Shiprocket Fulfillment Provider
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@sam-ael/medusa-plugin-shiprocket",
            id: "shiprocket",
            options: {
              email: process.env.SHIPROCKET_EMAIL,
              password: process.env.SHIPROCKET_PASSWORD,
              pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION,
            },
          },
        ],
      },
    },
    // Optional: Mailer as a Notification Provider
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@sam-ael/medusa-plugin-mailer/providers/mailer-notification",
            id: "mailer-notification",
            options: {},
          },
        ],
      },
    },
  ],
  plugins: [
    // Discord Notifications Plugin
    {
      resolve: "@sam-ael/medusa-plugin-discord",
      options: {
        defaultBotName: process.env.DISCORD_DEFAULT_BOT_NAME || "Store Bot",
      },
    },
    // Mailer Plugin (Admin Mapping UI & Subscribers)
    {
      resolve: "@sam-ael/medusa-plugin-mailer",
      options: {},
    },
    // Shiprocket Plugin (Admin Tracking Widget & Tracking Routes)
    {
      resolve: "@sam-ael/medusa-plugin-shiprocket",
      options: {},
    },
    // WhatsApp Cloud API Plugin
    {
      resolve: "@sam-ael/medusa-plugin-whatsapp",
      options: {},
    },
  ],
})
```

After registering any plugin that adds database tables (`discord`, `mailer`, `shiprocket`, `whatsapp`), run the database migrations:

```bash
npx medusa db:migrate
```

---

## Security Best Practices

When deploying plugins in production:

1. **Environment Secrets**: Store sensitive credentials (`PAYU_MERCHANT_KEY`, `PAYU_MERCHANT_SALT`, `SHIPROCKET_PASSWORD`, `WHATSAPP_ACCESS_TOKEN`, `MAILER_SMTP_PASS`) strictly in your production environment variables. Never commit secrets to version control.
2. **Webhook Verification**: Always configure inbound webhook URLs using HTTPS and ensure secret tokens (`SHIPROCKET_WEBHOOK_TOKEN`, PayU salt) match between your service dashboard and `.env`.
3. **Admin Permissions**: Admin endpoints for configuring mappings (`/admin/discord/*`, `/admin/mailer/*`, `/admin/whatsapp/*`) require an authenticated Medusa admin user session. Ensure appropriate role-based access control in your Medusa admin dashboard.

---

## License

This monorepo and all included packages are licensed under the [MIT License](LICENSE).
