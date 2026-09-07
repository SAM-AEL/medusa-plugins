# @sam-ael/medusa-plugin-payu

Production-ready PayU India payment provider for **Medusa v2** featuring redirect checkout, SHA-512 reverse-hash verification, timing-attack defense, underpayment discrepancy guards, and replay attack protection.

[![npm version](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-payu.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-payu)
[![npm downloads](https://img.shields.io/npm/dm/@sam-ael/medusa-plugin-payu.svg)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-payu)
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
- [Payment Lifecycle & Webhooks](#payment-lifecycle--webhooks)
  - [Checkout Flow](#checkout-flow)
  - [Inbound Webhook Specification](#inbound-webhook-specification)
  - [Cryptographic Verification](#cryptographic-verification)
- [Security & Production Hardening](#security--production-hardening)
- [Verification & Testing](#verification--testing)
- [License](#license)

---

## Overview & Architecture

[`@sam-ael/medusa-plugin-payu`](https://www.npmjs.com/package/@sam-ael/medusa-plugin-payu) integrates PayU India's hosted checkout system into the Medusa v2 Payment Module. The provider implements Medusa's `AbstractPaymentProvider` interface, managing the entire lifecycle of payment sessions, authorization, automated capture, and refunds.

### Payment Flow Diagram

```
Customer              Medusa v2 Storefront           Medusa v2 Backend             PayU Gateway
   |                            |                            |                          |
   |--- Select PayU Checkout -->|                            |                          |
   |                            |--- Initiate Session ------>|                          |
   |                            |                            |--- Calculate Hash ------>|
   |                            |<-- Payment URL + Params ---|                          |
   |--- Submit Form / Redirect -------------------------------------------------------->|
   |                                                                                    |
   |                               Customer Completes Payment on PayU Hosted Page       |
   |                                                                                    |
   |<-- Browser Redirect (Success/Failure) ---------------------------------------------|
   |                            |                                                       |
   |                            |                   Inbound Webhook Notification        |
   |                            |                   (POST /hooks/payment/payu_payu)     |
   |                            |                            |<-------------------------|
   |                            |                            |-- Timing-Safe Hash Check |
   |                            |                            |-- Replay Protection Check|
   |                            |                            |-- Amount Discrepancy     |
   |                            |                            |-- Authorize & Capture    |
```

---

## Features

- **Hosted Redirect Checkout:** Customers are securely redirected to PayU's PCI-DSS compliant checkout portal with auto-calculated request hashes.
- **Bi-Directional SHA-512 Verification:** Generates cryptographic outbound request hashes and verifies incoming reverse hashes with zero tolerance for parameter tampering.
- **Handling of `additionalCharges`:** Seamlessly supports PayU convenience fees and surcharges by dynamically prefixing `additionalCharges|` in reverse hash verification.
- **Timing Side-Channel Protection:** Employs `crypto.timingSafeEqual` across all hash comparisons to protect against timing attacks.
- **Replay Attack Defense:** In-memory sliding window cache deduplicates webhook transmissions, preventing double authorization or double capture.
- **Underpayment Discrepancy Guards:** Embeds initial order totals into user-defined fields (`udf4`) to detect and reject partial payment attacks.
- **Phone Number Normalization:** Automatically standardizes Indian phone numbers into valid 10-digit mobile formats expected by PayU.
- **Retry Logic with Jitter:** Server-to-server verification queries utilize exponential backoff and jitter across retryable HTTP status codes (`408`, `429`, `500`, `502`, `503`, `504`).

---

## Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)
- **PayU Merchant Account**: Active PayU India merchant account with a Merchant Key and Merchant Salt.

---

## Installation

Install the package in your Medusa backend project:

```bash
yarn add @sam-ael/medusa-plugin-payu
# or
npm install @sam-ael/medusa-plugin-payu
```

---

## Configuration

### 1. Register in `medusa-config.ts`

Register PayU as a payment provider inside `@medusajs/medusa/payment`:

```ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  // ... projectConfig, etc.
  modules: [
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
              environment: process.env.PAYU_ENVIRONMENT || "test", // "test" | "production"
            },
          },
        ],
      },
    },
  ],
})
```

### 2. Environment Variables

Define the following configuration variables in your `.env` file:

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `PAYU_MERCHANT_KEY` | `string` | Yes | — | PayU Merchant Key provided in the PayU dashboard. |
| `PAYU_MERCHANT_SALT` | `string` | Yes | — | PayU Merchant Salt provided in the PayU dashboard. |
| `PAYU_ENVIRONMENT` | `string` | No | `"test"` | PayU API environment (`test` or `production`). |
| `STOREFRONT_URL` | `string` | Yes | — | Base URL of your customer-facing storefront. |
| `PAYU_REDIRECT_URL` | `string` | No | `"/order/confirmed"` | Path on storefront for successful payment redirect. |
| `PAYU_REDIRECT_FAILURE_URL` | `string` | No | `"/checkout"` | Path on storefront for failed or canceled payment redirect. |
| `PAYU_API_TIMEOUT_MS` | `number` | No | `30000` | HTTP request timeout in milliseconds for PayU API calls. |

---

## Payment Lifecycle & Webhooks

### Checkout Flow

When a customer selects PayU at checkout, the provider generates:
1. A unique transaction ID (`txnid`) via `generateTxnId()`.
2. An outbound SHA-512 checksum:
   $$\text{hash} = \text{sha512}(\text{key} \mid \text{txnid} \mid \text{amount} \mid \text{productinfo} \mid \text{firstname} \mid \text{email} \mid \text{udf1} \dots \text{udf5} \mid \text{salt})$$
3. A redirect payload containing the checkout URL and form variables for the customer's browser.

### Inbound Webhook Specification

PayU dispatches asynchronous server-to-server notifications upon payment completion:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/hooks/payment/payu_payu` | Processes payment callbacks, validates reverse signatures, and transitions payment state in Medusa. |

### Cryptographic Verification

Upon receiving a callback, the provider computes the expected reverse signature:

$$\text{reverseHash} = \text{sha512}(\text{salt} \mid \text{status} \mid \text{udf10} \dots \text{udf1} \mid \text{email} \mid \text{firstname} \mid \text{productinfo} \mid \text{amount} \mid \text{txnid} \mid \text{key})$$

If PayU added a convenience fee, the formula automatically adapts to:
$$\text{reverseHash} = \text{sha512}(\text{additionalCharges} \mid \text{salt} \mid \text{status} \dots)$$

The result is compared against `payload.hash` using constant-time evaluation.

---

## Security & Production Hardening

- **Constant-Time Hash Comparison:** Eliminates timing side channels by utilizing Node.js's native `crypto.timingSafeEqual` buffer comparison.
- **Replay Protection Store:** Enforces a sliding 10-minute cache on transaction signatures (`txnid:status:mihpayid:amount`). Identical subsequent webhooks are acknowledged without triggering secondary payment captures.
- **Underpayment Fraud Guard:** The expected order total is signed into `udf4`. If the settled amount is lower than the required authorization amount, the payment is marked `requires_more` instead of authorized.
- **Sanitized Phone Formatting:** Validates and normalizes phone numbers to standard 10-digit Indian mobile formats (`^[6-9]\d{9}$`), stripping extraneous country prefixes and spaces.
- **Zero Credential Exposure:** Secret keys and salts are never returned in client-facing API responses or serialized into database session metadata.

---

## Verification & Testing

### Running Unit Tests

Execute the automated test suite verifying transaction ID generation, payment hash roundtrip, tampered hash rejection, `additionalCharges` handling, and phone normalization:

```bash
# From the monorepo root
yarn test
# Or specifically for PayU
node --no-warnings --loader ./scripts/ts-loader.mjs --test packages/medusa-plugin-payu/src/tests/payu.test.ts
```

### Sandbox Verification Flow

1. Set `PAYU_ENVIRONMENT=test` in your `.env`.
2. Start the Medusa development server.
3. In your storefront checkout, select PayU as the payment option and proceed.
4. You will be redirected to the PayU Sandbox payment page.
5. Use official PayU test cards (available on the PayU developer documentation) to simulate successful or failed authorizations.
6. Verify that the redirect lands on `PAYU_REDIRECT_URL` and the payment session in Medusa transitions to `authorized` or `captured`.

---

## License

This project is licensed under the [MIT License](LICENSE).
