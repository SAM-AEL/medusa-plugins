# @sam-ael/medusa-plugin-discord

Real-time Discord notification plugin for **Medusa v2** featuring live in-place embed updates, order tracking cards, and an interactive admin configuration dashboard.

[![npm version](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-discord.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-discord)
[![npm downloads](https://img.shields.io/npm/dm/@sam-ael/medusa-plugin-discord.svg)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-discord)
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
  - [Supported Events](#supported-events)
  - [Admin API Endpoints](#admin-api-endpoints)
  - [Template Placeholders](#template-placeholders)
- [Security & Production Hardening](#security--production-hardening)
- [Verification & Testing](#verification--testing)
- [License](#license)

---

## Overview & Architecture

[`@sam-ael/medusa-plugin-discord`](https://www.npmjs.com/package/@sam-ael/medusa-plugin-discord) connects your Medusa v2 store events to Discord channels via incoming webhooks. Rather than sending duplicate notifications for every status update, the plugin tracks message IDs per order in PostgreSQL (`discord_order_message` table) and edits the existing Discord embed card in place as an order moves through fulfillment, shipping, completion, or cancellation.

The plugin contains:
- **Discord Notification Module**: Built using Medusa's DML (`model.define`), exposing services to query mappings and track message state.
- **Event Subscribers**: Subscribes to Medusa core events (`order.placed`, `fulfillment.shipment_created`, etc.) and dispatches async notification workflows.
- **Admin UI Settings Extension**: An embedded settings panel in the Medusa Admin (`/app/settings/discord`) allowing store operators to map events to webhooks, customize templates, and dispatch test notifications.

---

## Features

- **In-Place Message Editing:** Updates the original Discord message when an order transitions from Placed → Fulfilled → Shipped → Completed/Canceled, keeping channels organized and spam-free.
- **Live Tracking & Carrier Links:** Automatically injects formatted tracking links and courier names into Discord embeds upon shipment creation.
- **Color-Coded Status Embeds:** Visual status badges with color transitions:
  - 🟡 Pending / Placed: `#FEE75C`
  - 🚚 Shipped: `#5865F2`
  - 🟢 Completed: `#57F287`
  - 🔴 Canceled: `#ED4245`
- **Custom Markdown Templates:** Configurable notification text templates with token interpolation (`{display_id}`, `{total}`, `{email}`, etc.).
- **Currency Normalization:** Automatically converts Medusa integer cents/minor units into formatted decimal currency strings across international currencies.
- **Mention Sanitization:** Neutralizes `@everyone`, `@here`, and role/user mention syntax to prevent channel hijacking from untrusted customer input.
- **Interactive Admin Dashboard:** Full CRUD management of webhook mappings directly within the Medusa Admin interface.

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)
- **PostgreSQL**: `v14` or higher
- **Discord Server**: A server with permission to create webhooks (**Server Settings → Integrations → Webhooks**)

---

## Installation

Install the package into your Medusa v2 project:

```bash
yarn add @sam-ael/medusa-plugin-discord
# or
npm install @sam-ael/medusa-plugin-discord
```

---

## Configuration

### 1. Register in `medusa-config.ts`

Add the plugin to your `medusa-config.ts` plugins array:

```ts
import { defineConfig } from "@medusajs/framework/utils"
import type { DiscordNotificationOptions } from "@sam-ael/medusa-plugin-discord"

export default defineConfig({
  // ... projectConfig, modules, etc.
  plugins: [
    {
      resolve: "@sam-ael/medusa-plugin-discord",
      options: {
        defaultBotName: process.env.DISCORD_DEFAULT_BOT_NAME || "Store Bot",
      } satisfies DiscordNotificationOptions,
    },
  ],
})
```

### 2. Environment Variables

Configure the following environment variables in your `.env` file:

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `DISCORD_DEFAULT_BOT_NAME` | `string` | No | `"Discord Bot"` | Default username displayed on webhook messages when not overridden per mapping. |

### 3. Database Migrations

Run Medusa migrations to create the required tables (`discord_webhook_mapping`, `discord_order_message`) and composite lookup indexes:

```bash
npx medusa db:migrate
```

---

## API & Event Reference

### Supported Events

The plugin listens for the following Medusa events:

| Event Name | Trigger | Discord Action |
|---|---|---|
| `order.placed` | New customer order created | Posts a new embed message and records the Discord message ID. |
| `order.fulfillment_created` | Items fulfilled in warehouse | Edits existing order embed with fulfillment progress. |
| `fulfillment.shipment_created` | Carrier tracking details assigned | Edits order embed to include carrier, tracking number, and URL. |
| `order.completed` | Order marked as completed | Edits order embed to completed status (green). |
| `order.canceled` | Order canceled | Edits order embed to canceled status (red). |
| `order.updated` | Order details modified | Edits order embed with updated information. |
| `customer.created` | New customer registration | Posts a new welcome notification to mapped channel. |
| `customer.updated` | Customer profile updated | Posts an account update notification. |

### Admin API Endpoints

All admin endpoints require an authenticated Medusa admin user session.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/discord/mappings` | List all configured webhook mappings. |
| `POST` | `/admin/discord/mappings` | Create a new webhook mapping (validated against a Discord webhook URL allowlist). |
| `POST` | `/admin/discord/mappings/:id` | Update an existing webhook mapping. |
| `DELETE` | `/admin/discord/mappings/:id` | Delete a webhook mapping. |
| `POST` | `/admin/discord/test` | Dispatch a test notification with synthetic order data to verify webhook connectivity. |

#### Create Mapping Request Payload Example

```json
{
  "event_name": "order.placed",
  "webhook_url": "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz",
  "channel_name": "#orders",
  "bot_name": "Sales Bot",
  "is_active": true,
  "message_template": "📦 New order **#{display_id}** from **{email}** — **{total} {currency_code}**"
}
```

### Template Placeholders

The following tokens can be used in the `message_template` field:

| Token | Description | Example |
|---|---|---|
| `{display_id}` | Order display ID | `1001` |
| `{email}` | Customer email address | `customer@example.com` |
| `{total}` | Formatted monetary amount | `149.50` |
| `{currency_code}` | ISO 4217 uppercase currency code | `USD`, `EUR`, `INR` |
| `{tracking_links}` | Formatted carrier tracking links | `[Track: TRK123](https://...)` |
| `{status}` | Order or fulfillment status | `shipped` |

---

## Security & Production Hardening

- **Mention Hijacking Defense:** Customer-submitted data (names, notes, addresses) is sanitized to neutralize `@everyone`, `@here`, `<@...>`, and `<@&...>` mentions, preventing malicious users from tagging channel members.
- **Webhook URL Protocol Validation:** Webhook targets are strictly validated against `https://discord.com/api/webhooks/` (or `https://discordapp.com/api/webhooks/`), rejecting insecure HTTP schemes and arbitrary external URLs.
- **Input Validation:** All admin API endpoints validate request payloads inline. Webhook URLs are checked against an allowlist that only permits `https://discord.com/api/webhooks/{id}/{token}` (and the legacy `discordapp.com` host), which blocks SSRF via arbitrary URLs.
- **Dual Error Envelope Normalization:** The Admin UI extension handles both structured API errors (`{ message, error, code }`) and Medusa framework errors (`{ type, message }`) with graceful fallback messages.
- **Database Index Optimization:** Composite indexes (`idx_discord_order_msg_lookup`, `idx_discord_order_msg_webhook_url`, `idx_discord_mapping_webhook_url`) optimize message lookup performance under high order volume.

---

## Verification & Testing

### Running Unit Tests

Execute the automated test suite covering webhook URL validation, currency conversion, mention escaping, and event mappings:

```bash
# From the monorepo root
yarn test
# Or specifically for Discord
node --no-warnings --loader ./scripts/ts-loader.mjs --test packages/medusa-plugin-discord/src/tests/discord.test.ts
```

### Manual Verification Flow

1. Start your Medusa development server:
   ```bash
   npx medusa develop
   ```
2. Log in to the Medusa Admin panel and navigate to **Settings → Discord Notifications**.
3. Click **Add Mapping**, select `order.placed`, paste a valid Discord channel webhook URL, and save.
4. Click **Send Test Notification**.
5. Confirm that a test notification card with rich embeds appears immediately in the target Discord channel.

---

## License

This project is licensed under the [MIT License](LICENSE).
