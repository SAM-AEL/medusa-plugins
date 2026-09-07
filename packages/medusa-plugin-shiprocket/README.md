# @sam-ael/medusa-plugin-shiprocket

Enterprise Shiprocket fulfillment provider and logistics plugin for **Medusa v2** featuring automated AWB assignment, pickup scheduling, real-time scan synchronization, returns management, and an Admin UI order tracking widget.

[![npm version](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-shiprocket.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-shiprocket)
[![npm downloads](https://img.shields.io/npm/dm/@sam-ael/medusa-plugin-shiprocket.svg)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-shiprocket)
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
- [API & Webhook Reference](#api--webhook-reference)
  - [Inbound Webhook Specification](#inbound-webhook-specification)
  - [API Endpoints](#api-endpoints)
- [Security & Production Hardening](#security--production-hardening)
- [Verification & Testing](#verification--testing)
- [License](#license)

---

## Overview & Architecture

[`@sam-ael/medusa-plugin-shiprocket`](https://www.npmjs.com/package/@sam-ael/medusa-plugin-shiprocket) provides an end-to-end integration between Medusa v2 and Shiprocket's courier logistics aggregation network across India.

The package implements two core integration layers:
1. **Fulfillment Provider Module:** Extends Medusa's `AbstractFulfillmentProviderService` under `@medusajs/medusa/fulfillment` to handle courier calculation, fulfillment creation, cancellation, and label retrieval.
2. **Logistics Lifecycle Plugin:** Provides custom DML tracking persistence (`shiprocket_tracking` entity), inbound status webhook processing, rate-limited public tracking endpoints, and an interactive tracking widget embedded directly into the Medusa Admin Order Details view.

---

## Features

- **Order Details Admin Widget:** Embedded tracking widget on the Medusa Admin Order Details page displaying tracking timelines, current shipment status, courier information, download buttons for shipping labels and invoices, and actions to schedule or cancel pickups.
- **Automated AWB Allocation:** Generates Shiprocket shipments and retrieves Air Waybill (AWB) tracking numbers automatically when a fulfillment is created.
- **Smart Pickup Scheduling:** Automatically requests courier pickup from the configured merchant pickup location once an AWB is assigned.
- **Payment Method Mapping:** Intelligently maps Medusa payment status to Shiprocket COD (Cash on Delivery) or Prepaid models.
- **Return Logistics Management:** Calculates return shipment parcel dimensions to prevent volumetric carrier discrepancy penalties.
- **Rate-Limited Storefront Tracking:** Exposes a secure public tracking endpoint for storefronts, fortified with an in-memory sliding-window rate limiter.
- **Timing-Safe Inbound Webhooks:** Verifies incoming scan and delivery updates from Shiprocket using constant-time token comparison.

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)
- **PostgreSQL**: `v14` or higher
- **Shiprocket Merchant Account**: Active account with configured pickup addresses and API user credentials.

---

## Installation

Install the package into your Medusa project:

```bash
yarn add @sam-ael/medusa-plugin-shiprocket
# or
npm install @sam-ael/medusa-plugin-shiprocket
```

---

## Configuration

### 1. Register in `medusa-config.ts`

Register both the fulfillment provider inside `modules` and the admin/tracking extension under `plugins`:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ... projectConfig, etc.
  modules: [
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
  ],
  plugins: [
    {
      resolve: "@sam-ael/medusa-plugin-shiprocket",
      options: {},
    },
  ],
})
```

### 2. Environment Variables

Define the following configuration variables in your `.env` file:

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `SHIPROCKET_EMAIL` | `string` | Yes | — | Shiprocket account login email. |
| `SHIPROCKET_PASSWORD` | `string` | Yes | — | Shiprocket account login password. |
| `SHIPROCKET_PICKUP_LOCATION` | `string` | Yes | — | Registered pickup location name matching your Shiprocket dashboard settings. |
| `SHIPROCKET_WEBHOOK_TOKEN` | `string` | Yes | — | Secret token string used to authenticate inbound delivery webhooks. |
| `SHIPROCKET_DELIVERY_PREFERENCE` | `string` | No | `"FAST"` | Courier selection strategy (`FAST` or `CHEAP`). |
| `SHIPROCKET_API_TIMEOUT_MS` | `number` | No | `15000` | HTTP request timeout in milliseconds for Shiprocket API requests. |
| `SHIPROCKET_WEBHOOK_PAYLOAD_RETENTION_DAYS` | `number` | No | `30` | Number of days to retain raw webhook payloads before cleanup. |

### 3. Database Migrations

Run migrations to initialize the `shiprocket_tracking` table and the `idx_shiprocket_tracking_fulfillment` index:

```bash
npx medusa db:migrate
```

---

## API & Webhook Reference

### Inbound Webhook Specification

Configure your Shiprocket dashboard to deliver scan updates to:
`https://your-medusa-domain.com/hooks/fulfillment/delivery-updates`

| Method | Endpoint | Authentication | Description |
|---|---|---|---|
| `POST` | `/hooks/fulfillment/delivery-updates` | Header: `x-api-key` | Ingests courier delivery, out-for-delivery, and transit scans in real time. |

> [!NOTE]
> The value of the `x-api-key` request header must match the value configured in `SHIPROCKET_WEBHOOK_TOKEN`.

### API Endpoints

| Method | Endpoint | Auth Level | Description |
|---|---|---|---|
| `POST` | `/admin/shiprocket/tracking/:awb/sync` | Admin Session | Forces on-demand synchronization of an AWB's status from Shiprocket API. |
| `GET` | `/admin/shiprocket/tracking/:awb` | Admin Session | Retrieves tracking timeline and shipment metadata for an AWB. |
| `GET` | `/store/shiprocket/tracking/:awb` | Public / Rate-Limited | Customer-facing endpoint for retrieving tracking timeline by AWB. Scoped to authenticated customer if logged in. |

---

## Security & Production Hardening

- **Timing Side-Channel Protection:** Incoming webhook authentication evaluates `x-api-key` headers against `SHIPROCKET_WEBHOOK_TOKEN` using `crypto.timingSafeEqual`.
- **AWB Sanitization:** AWB parameters are validated against strict alphanumeric patterns (`/^[a-zA-Z0-9_-]{4,50}$/`), mitigating injection vulnerabilities.
- **Sliding-Window Public Rate Limiting:** The public `/store/shiprocket/tracking/:awb` route enforces a sliding-window rate limit per client IP (respecting `x-forwarded-for` and proxy hops), defending against scraping and denial-of-service attempts.
- **Webhook Deduplication:** Incoming scans are deduplicated using a compound signature (`${awb}:${current_status_id}:${current_timestamp}`), preventing duplicate status updates.
- **Credential Segregation:** Shiprocket authentication tokens are generated and cached in memory; passwords and bearer tokens are never exposed in administrative API responses.

---

## Verification & Testing

### Running Unit Tests

Execute the automated test suite verifying AWB validation, retryable HTTP statuses, rate limiter sliding-window enforcement, and client IP extraction precedence:

```bash
# From the monorepo root
yarn test
# Or specifically for Shiprocket
node --no-warnings --loader ./scripts/ts-loader.mjs --test packages/medusa-plugin-shiprocket/src/tests/shiprocket.test.ts
```

### Manual Verification Flow

1. Set valid test or production Shiprocket credentials in `.env`.
2. Start the Medusa backend:
   ```bash
   npx medusa develop
   ```
3. In the Medusa Admin panel, open an existing order and click **Create Fulfillment**, selecting **Shiprocket** as the fulfillment provider.
4. Verify that the order is synchronized to Shiprocket, an AWB is assigned, and the tracking timeline widget renders on the Order Details page.
5. In the widget, verify that the **Sync Tracking** and **Download Label** actions execute successfully.

---

## License

This project is licensed under the [MIT License](LICENSE).
