# @sam-ael/medusa-plugin-whatsapp

Meta WhatsApp Cloud API notification plugin for **Medusa v2** featuring dynamic event mapping, template dispatching, automated PII log redaction, and an administrative control panel.

[![npm version](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-whatsapp.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-whatsapp)
[![npm downloads](https://img.shields.io/npm/dm/@sam-ael/medusa-plugin-whatsapp.svg)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-whatsapp)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.12.0+-blue.svg)](https://medusajs.com/)
[![Node.js](https://img.shields.io/badge/Node.js->=20.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#verification--testing)

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [1. Register in medusa-config.ts](#1-register-in-medusa-configts)
  - [2. Environment Variables](#2-environment-variables)
  - [3. Database Migrations](#3-database-migrations)
- [API & Event Reference](#api--event-reference)
  - [Admin API Endpoints](#admin-api-endpoints)
  - [Supported Medusa Events](#supported-medusa-events)
  - [Template Variables Mapping](#template-variables-mapping)
- [Security & Production Hardening](#security--production-hardening)
- [Verification & Testing](#verification--testing)
- [License](#license)

---

## Overview & Architecture

[`@sam-ael/medusa-plugin-whatsapp`](https://www.npmjs.com/package/@sam-ael/medusa-plugin-whatsapp) empowers Medusa v2 store operators to deliver automated, transactional WhatsApp notifications to customers via the official Meta WhatsApp Cloud API. 

The architecture consists of:
- **WhatsApp Service & Workflows:** Dispatches pre-approved Meta message templates asynchronously using Medusa workflows and background workers.
- **DML Schema Persistence:** Manages mappings (`whatsapp_event_mapping`) and message transmission logs (`whatsapp_message_log`) in PostgreSQL with optimized indexes.
- **Admin Settings Extension:** Embedded management interface in Medusa Admin (`/app/settings/whatsapp`) for syncing approved templates from Meta, mapping event variables, and auditing redacted delivery logs.

---

## Features

- **Official Cloud API Integration:** Connects directly to Meta's WhatsApp Business Platform (`graph.facebook.com`) without intermediary third-party SMS gateways.
- **Admin Mapping Dashboard:** Link any Medusa store event (`order.placed`, `order.fulfillment_created`, etc.) to approved WhatsApp templates and assign variable paths visually.
- **Automatic PII Redaction:** Transmission logs automatically mask sensitive personal identifiable information, including phone numbers, auth tokens, passwords, and credit card numbers.
- **E.164 Strict Phone Normalization:** Parses international phone numbers, removes non-numeric formatting, and guarantees valid E.164 format before hitting Meta's API.
- **Prototype Pollution Guards:** Safe object path resolution prevents prototype tampering during payload variable extraction.
- **Configurable Concurrency & Timeouts:** Built-in concurrency controls prevent API rate-limit throttling from Meta during bulk event triggers.

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)
- **PostgreSQL**: `v14` or higher
- **Meta Developer Account**: Configured WhatsApp Business App with:
  - Phone Number ID
  - WhatsApp Business Account ID (WABA)
  - Permanent System User Access Token with `whatsapp_business_messaging` permissions

---

## Installation

Install the package into your Medusa project:

```bash
yarn add @sam-ael/medusa-plugin-whatsapp
# or
npm install @sam-ael/medusa-plugin-whatsapp
```

---

## Configuration

### 1. Register in `medusa-config.ts`

Add the plugin to your `medusa-config.ts` plugins array:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ... projectConfig, etc.
  plugins: [
    {
      resolve: "@sam-ael/medusa-plugin-whatsapp",
      options: {},
    },
  ],
})
```

### 2. Environment Variables

Define Meta Cloud API credentials and operational limits in `.env`:

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | `string` | Yes | — | Sender Phone Number ID from Meta Developer Console. |
| `WHATSAPP_ACCESS_TOKEN` | `string` | Yes | — | System User Permanent Access Token with messaging permissions. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `string` | Yes | — | WhatsApp Business Account ID (WABA ID). |
| `WHATSAPP_API_VERSION` | `string` | No | `"v25.0"` | Meta Graph API version string. |
| `WHATSAPP_SEND_CONCURRENCY` | `number` | No | `2` | Maximum concurrent HTTP dispatches to Meta API. |
| `WHATSAPP_API_TIMEOUT_MS` | `number` | No | `15000` | HTTP request timeout in milliseconds. |
| `WHATSAPP_LOG_RETENTION_DAYS` | `number` | No | `30` | Number of days to retain message transmission logs. |

### 3. Database Migrations

Run migrations to initialize `whatsapp_event_mapping` and `whatsapp_message_log` tables:

```bash
npx medusa db:migrate
```

---

## API & Event Reference

### Admin API Endpoints

All admin routes require an authenticated Medusa admin user session.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/whatsapp/config` | Retrieves non-sensitive WhatsApp configuration parameters. |
| `POST` | `/admin/whatsapp/config` | Updates non-sensitive configuration parameters. |
| `GET` | `/admin/whatsapp/templates` | Queries Meta Graph API to fetch approved WhatsApp templates and their parameter definitions. |
| `GET` | `/admin/whatsapp/mappings` | Lists configured event-to-template mappings. |
| `POST` | `/admin/whatsapp/mappings` | Creates a new event mapping (validated inline). |
| `POST` | `/admin/whatsapp/mappings/:id` | Updates an existing event mapping. |
| `DELETE` | `/admin/whatsapp/mappings/:id` | Deletes an event mapping. |
| `GET` | `/admin/whatsapp/logs` | Fetches historical message transmission logs with PII automatically redacted. |
| `POST` | `/admin/whatsapp/manual` | Dispatches an ad-hoc test template message to a specified recipient phone. |

### Supported Medusa Events

- `order.placed`
- `order.fulfillment_created`
- `fulfillment.shipment_created`
- `order.completed`
- `order.canceled`
- `order.updated`
- `customer.created`
- `customer.updated`

### Template Variables Mapping

WhatsApp templates require body parameters ordered by index (e.g. `{{1}}`, `{{2}}`). In the Admin UI or API payload, specify an array or map resolving each placeholder index to an entity attribute:

```json
{
  "event_name": "order.placed",
  "template_name": "order_confirmation",
  "language_code": "en_US",
  "recipient_phone_path": "shipping_address.phone",
  "variables": {
    "1": "customer.first_name",
    "2": "display_id",
    "3": "total"
  },
  "is_active": true
}
```

---

## Security & Production Hardening

- **Automated PII Redaction:** Transmission logs saved to the database undergo recursive sanitization, masking recipient phone digits (preserving only the last 4 characters, e.g. `+91 ****** 3210`) and completely scrubbing passwords, credit cards, and tokens.
- **Strict E.164 Phone Normalization:** Phone inputs are sanitized, eliminating alphanumeric noise, formatting characters, and invalid country codes before hitting Meta's API endpoints.
- **Token Isolation:** The `WHATSAPP_ACCESS_TOKEN` is strictly environment-bound. It is excluded from admin API responses and never persisted in database configurations.
- **Prototype Pollution Guards:** Data path lookups (`customer.first_name`) reject paths containing `__proto__`, `constructor`, or `prototype`.
- **Database Index Optimization:** Composite indexes (`idx_whatsapp_event_active`, `idx_whatsapp_log_created`) ensure fast query execution for event matching and paginated log retrieval.

---

## Verification & Testing

### Running Unit Tests

Execute the automated test suite verifying E.164 normalization, log redaction policy, path traversal protection, and variable extraction:

```bash
# From the monorepo root
yarn test
# Or specifically for WhatsApp
node --no-warnings --loader ./scripts/ts-loader.mjs --test packages/medusa-plugin-whatsapp/src/tests/whatsapp.test.ts
```

### Manual Verification Flow

1. Set valid Meta WhatsApp Cloud credentials in your `.env` (a Meta sandbox test number can be used).
2. Start your Medusa backend:
   ```bash
   npx medusa develop
   ```
3. Open Medusa Admin and navigate to **Settings → WhatsApp**.
4. Confirm that approved templates are synchronized from your Meta Business account.
5. In the **Test Message** modal, enter an approved template name and your verified WhatsApp test recipient number.
6. Dispatch the test message and verify instant delivery on your WhatsApp device.
7. Navigate to **Transmission Logs** and confirm the dispatch appears with masked recipient phone numbers.

---

## License

This project is licensed under the [MIT License](./LICENSE).
