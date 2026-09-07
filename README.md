# Medusa Plugins

Production-ready integration plugins, payment providers, and fulfillment services for **Medusa v2**.

[![Medusa v2](https://img.shields.io/badge/Medusa-v2.12.0+-blue.svg)](https://medusajs.com/)
[![Node.js](https://img.shields.io/badge/Node.js->=20.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](#monorepo-development)

---

## Packages Directory

Each package is published independently to npm and maintained within this monorepo. Refer to each package's README for complete installation instructions, `medusa-config.ts` registration, environment variables, and API/webhook references.

| Package | NPM | Type | Description | Docs |
|---|---|---|---|---|
| **`@sam-ael/medusa-plugin-discord`** | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-discord.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-discord) | Notification Plugin | Real-time Discord notifications with live in-place embed updates per order and an admin settings dashboard. | [Documentation →](./packages/medusa-plugin-discord/README.md) |
| **`@sam-ael/medusa-plugin-mailer`** | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-mailer.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-mailer) | Plugin & Notification Provider | Event-driven transactional email via SMTP with dynamic admin template mappings and Notification Provider module. | [Documentation →](./packages/medusa-plugin-mailer/README.md) |
| **`@sam-ael/medusa-plugin-payu`** | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-payu.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-payu) | Payment Provider | PayU India redirect checkout provider with SHA-512 verification, underpayment defense, and replay protection. | [Documentation →](./packages/medusa-plugin-payu/README.md) |
| **`@sam-ael/medusa-plugin-shiprocket`** | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-shiprocket.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-shiprocket) | Fulfillment Provider & Plugin | Shiprocket fulfillment integration with AWB allocation, courier pickups, returns, and order details tracking widget. | [Documentation →](./packages/medusa-plugin-shiprocket/README.md) |
| **`@sam-ael/medusa-plugin-whatsapp`** | [![npm](https://img.shields.io/npm/v/@sam-ael/medusa-plugin-whatsapp.svg?color=CB3837)](https://www.npmjs.com/package/@sam-ael/medusa-plugin-whatsapp) | Notification Plugin | Meta WhatsApp Cloud API template notifications with admin mapping, strict phone normalization, and PII log redaction. | [Documentation →](./packages/medusa-plugin-whatsapp/README.md) |

---

## Monorepo Development

This repository uses Yarn Workspaces to manage development across all packages.

### Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Package Manager**: `yarn` or `npm`
- **Medusa Backend**: Medusa v2 (`>= 2.12.0`)

### Setup

```bash
# Clone the monorepo
git clone https://github.com/SAM-AEL/medusa-plugins.git
cd medusa-plugins

# Install workspace dependencies
yarn install
```

### Running Tests

Automated unit test suites are included for every package using Node's native test runner (`node:test`):

```bash
# Run all package test suites
yarn test
# or
node scripts/run-tests.cjs
```

### Building Packages

```bash
# Build all packages
yarn build

# Run typecheck across all workspaces
yarn typecheck
```

---

## License

All packages in this repository are licensed under the [MIT License](LICENSE).
