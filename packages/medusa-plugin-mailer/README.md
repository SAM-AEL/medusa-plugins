# @sam-ael/medusa-plugin-mailer

Event-driven transactional email plugin and Notification Provider for **Medusa v2** featuring dynamic template mapping, multi-sender SMTP profiles, HTML sanitization, and an administrative control panel.

[![npm version](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-mailer.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-mailer)
[![npm downloads](https://img.shields.io/npm/dm/@sam-ael/medusa-plugin-mailer.svg)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-mailer)
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
  - [Supported Core Events](#supported-core-events)
  - [Admin API Endpoints](#admin-api-endpoints)
  - [Template Placeholders & Variable Resolution](#template-placeholders--variable-resolution)
- [Security & Production Hardening](#security--production-hardening)
- [Verification & Testing](#verification--testing)
- [License](#license)

---

## Overview & Architecture

[`@sam-ael/medusa-plugin-mailer`](https://www.npmjs.com/package/@sam-ael/medusa-plugin-mailer) provides a comprehensive transactional email engine for Medusa v2 applications. It eliminates the need for hardcoded email triggers by allowing operators to configure event-to-template mappings dynamically in PostgreSQL via an intuitive Admin UI.

The package supports two complementary integration modes:
1. **Event-Driven Plugin:** Listens to Medusa event bus triggers, hydratively resolves complex order/fulfillment data graphs, maps them into HTML templates, and delivers emails via Nodemailer SMTP.
2. **Medusa Notification Provider:** Exposes `MailerNotificationProviderService` (extending `AbstractNotificationProviderService`) for native integration with `@medusajs/medusa/notification` workflows.

---

## Features

- **Dynamic Event Mapping:** Map any Medusa core event or custom application event to an HTML template file, subject line, and recipient policy without restarting the server.
- **Admin Management UI:** Integrated sidebar page in Medusa Admin (`/app/mailer`) for inspecting SMTP status, previewing available templates, managing mappings, and executing test sends.
- **Data Graph Hydration:** Automatically resolves full relational graphs for orders (line items, addresses, tax, totals) and shipments (carrier, tracking numbers, tracking URLs).
- **Multi-Sender Profiles:** Define up to 5 distinct sender identities (`MAILER_FROM_NAME_1`, `_2`, etc.) and assign them individually per event mapping.
- **Bundled & Custom Templates:** Ships with responsive default HTML templates for all common e-commerce events, while allowing complete overrides via a custom templates directory.
- **Prototype Pollution Defense:** Variable path resolution strictly blocks access to `__proto__`, `constructor`, and `prototype` keys.
- **Path Traversal Protection:** Validates requested template files against directory boundaries to prevent arbitrary file disclosure.
- **Header Injection Mitigation:** Normalizes recipient and subject inputs, stripping carriage returns and newlines (`\r`, `\n`) to prevent SMTP header smuggling.

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)
- **PostgreSQL**: `v14` or higher
- **SMTP Server**: Valid credentials for an SMTP relay (e.g., Amazon SES, Postmark, Brevo, SendGrid, or internal mail server)

---

## Installation

Install the mailer plugin along with Nodemailer:

```bash
yarn add @sam-ael/medusa-plugin-mailer nodemailer
# or
npm install @sam-ael/medusa-plugin-mailer nodemailer
```

---

## Configuration

### 1. Register in `medusa-config.ts`

Add the plugin to your `plugins` list, and optionally register the notification provider in `modules`:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ... projectConfig, etc.
  modules: [
    // Optional: Register as an official Medusa Notification Provider
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
    // Register the Mailer Plugin (Admin UI, Event Subscribers & Workflows)
    {
      resolve: "@sam-ael/medusa-plugin-mailer",
      options: {},
    },
  ],
})
```

### 2. Environment Variables

Configure SMTP connectivity and branding in your `.env` file:

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `MAILER_SMTP_HOST` | `string` | Yes | — | SMTP server hostname (e.g. `smtp.sendgrid.net`, `email-smtp.us-east-1.amazonaws.com`). |
| `MAILER_SMTP_PORT` | `number` | No | `587` | SMTP port (`587` for STARTTLS, `465` for SSL/TLS). |
| `MAILER_SMTP_USER` | `string` | Yes | — | SMTP authentication username. |
| `MAILER_SMTP_PASS` | `string` | Yes | — | SMTP authentication password. |
| `MAILER_SMTP_SECURE` | `boolean` | No | `false` | Set to `true` when connecting over port 465. |
| `MAILER_FROM_NAME_1` | `string` | Yes | — | Default sender display name (Profile 1). |
| `MAILER_FROM_ADDRESS_1` | `string` | Yes | — | Default sender email address (Profile 1). |
| `MAILER_FROM_NAME_2` … `_5` | `string` | No | — | Optional secondary sender profile display names. |
| `MAILER_FROM_ADDRESS_2` … `_5` | `string` | No | — | Optional secondary sender email addresses. |
| `MAILER_TEMPLATES_DIR` | `string` | No | Bundled | Custom directory path containing `.html` templates. |
| `STORE_NAME` | `string` | No | `"My Store"` | Global store name injected into `{{ .StoreName }}`. |
| `STORE_URL` / `STOREFRONT_URL` | `string` | No | — | Storefront root URL injected into `{{ .SiteURL }}`. |
| `MAILER_LOGO_URL` | `string` | No | — | Absolute URL to store logo image for `{{ .LogoURL }}`. |
| `MAILER_SEND_CONCURRENCY` | `number` | No | `2` | Maximum concurrent email dispatches per event trigger. |
| `MAILER_SMTP_DEBUG` | `boolean` | No | `false` | Enable verbose Nodemailer connection debug logs. |

### 3. Database Migrations

Create the `mailer_event_mapping` table and the `idx_mailer_event_active` composite index:

```bash
npx medusa db:migrate
```

---

## API & Event Reference

### Supported Core Events

The plugin listens for the following Medusa event patterns:

| Domain | Event Names | Typical Template Usage |
|---|---|---|
| **Orders** | `order.placed`<br>`order.completed`<br>`order.canceled`<br>`order.fulfillment_created` | Order confirmation, fulfillment progress, cancellation notices. |
| **Fulfillment** | `shipment.created`<br>`delivery.created`<br>`fulfillment.shipment_created` | Shipment with tracking link, delivery confirmation. |
| **Customers** | `customer.created`<br>`customer.updated` | Welcome email, account profile update notification. |
| **Returns** | `order.return_requested`<br>`order.return_received` | Return request instructions, return receipt & refund confirmation. |
| **Custom** | `loyalty.points_credited`<br>`wallet.credited` | Application-specific loyalty and wallet notifications. |

### Admin API Endpoints

All endpoints require an authenticated Medusa admin principal. These routes do not declare their own `middlewares.ts`, so they rely on the Medusa framework default of authenticating every route that does not explicitly opt out (`AUTHENTICATE = false`). Both admin **session cookies** and admin **API keys** are accepted.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/mailer/config` | Returns SMTP configuration status and configured sender profiles. |
| `GET` | `/admin/mailer/templates` | Lists available `.html` templates and detects declared placeholder tokens. |
| `GET` | `/admin/mailer/mappings` | Retrieves all event-to-template mappings. |
| `POST` | `/admin/mailer/mappings` | Creates a new event-to-template mapping (validated inline). |
| `POST` | `/admin/mailer/mappings/:id` | Updates an existing mapping configuration. |
| `DELETE` | `/admin/mailer/mappings/:id` | Deletes a mapping. |
| `POST` | `/admin/mailer/send` | Dispatches an ad-hoc test email to verify SMTP and template rendering. |

### Template Placeholders & Variable Resolution

Templates utilize Go-style mustache interpolation tokens (`{{ .VariableName }}`):

#### Global Variables (Always Available)
- `{{ .StoreName }}`: Resolved from `STORE_NAME` environment variable.
- `{{ .SiteURL }}` / `{{ .StoreURL }}`: Resolved from `STORE_URL` or `STOREFRONT_URL`.
- `{{ .RecipientEmail }}`: Resolved recipient email address.
- `{{ .Subject }}`: Processed subject line with token interpolation.
- `{{ .LogoURL }}`: Resolved from `MAILER_LOGO_URL`.

#### Dynamic Entity Variables
Operators map template keys to object paths on the event entity. For example:

```json
{
  "first_name": "customer.first_name",
  "display_id": "display_id",
  "total": "total",
  "tracking_number": "labels.0.tracking_number",
  "tracking_url": "labels.0.tracking_url"
}
```

---

## Security & Production Hardening

- **Directory Traversal Protection:** Custom templates requested via `MAILER_TEMPLATES_DIR` are normalized using `path.resolve` and verified against the base directory to prevent `../` directory escapes.
- **Prototype Pollution Prevention:** Nested property path traversal explicitly excludes `__proto__`, `constructor`, and `prototype` property keys.
- **HTML & XSS Sanitization:** Values interpolated into HTML templates are HTML-escaped, so customer-supplied data cannot inject markup or script tags.
- **Strict URL Protocol Filtering:** Links interpolated into templates are restricted to the `http:` and `https:` protocols.
- **Header Injection Defense:** Recipient email addresses and subject lines are stripped of carriage returns (`\r`) and newlines (`\n`).
- **Resilient Degraded Mode:** If SMTP credentials are missing or incomplete, the plugin logs a warning and gracefully skips dispatch rather than crashing the process or blocking order completion.

---

## Verification & Testing

### Running Unit Tests

Execute the automated test suite covering HTML escaping, URL safety, directory traversal resistance, prototype pollution guards, and RFC email sanitization:

```bash
# From the monorepo root
yarn test
# Or specifically for Mailer
node --no-warnings --loader ./scripts/ts-loader.mjs --test packages/medusa-plugin-mailer/src/tests/mailer.test.ts
```

### Manual Verification Flow

1. Start your Medusa backend:
   ```bash
   npx medusa develop
   ```
2. Open the Medusa Admin panel and navigate to **Mailer** in the primary navigation.
3. Verify that the SMTP status indicator displays **Configured**.
4. In the **Send Test Email** section, select a template (e.g. `order_placed.html`), enter a test recipient email address, and click **Send**.
5. Confirm receipt of the test email in your inbox with correctly rendered styles and branding.

---

## License

This project is licensed under the [MIT License](LICENSE).
