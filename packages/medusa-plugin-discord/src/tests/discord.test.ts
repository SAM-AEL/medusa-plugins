import test from "node:test"
import assert from "node:assert/strict"
import {
    normalizeWebhookUrl,
    isValidWebhookUrl,
    SUPPORTED_DISCORD_EVENTS,
    toMajorUnits,
    getCurrencyFormatter,
    discordEscape
} from "../shared/discord-fields"

test("Discord Webhook URL Normalization & Validation", () => {
    // Valid standard discord webhook
    const validStandard = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_123456"
    assert.equal(isValidWebhookUrl(validStandard), true)

    // Valid legacy discordapp webhook
    const validLegacy = "https://discordapp.com/api/webhooks/123456789012345678/token_abc123"
    assert.equal(isValidWebhookUrl(validLegacy), true)

    // Trailing slash normalization
    assert.equal(isValidWebhookUrl(validStandard + "/"), true)
    assert.equal(normalizeWebhookUrl(validStandard + "///"), validStandard)

    // Invalid webhook URLs
    assert.equal(isValidWebhookUrl("https://evil.com/api/webhooks/123/abc"), false)
    assert.equal(isValidWebhookUrl("http://discord.com/api/webhooks/123/abc"), false, "HTTP rejected")
    assert.equal(isValidWebhookUrl("https://discord.com/other/path"), false)
    assert.equal(isValidWebhookUrl(""), false)
    assert.equal(isValidWebhookUrl("javascript:alert(1)"), false)
})

test("Discord Unit Conversion: toMajorUnits", () => {
    assert.equal(toMajorUnits(12550), 125.5)
    assert.equal(toMajorUnits(100), 1)
    assert.equal(toMajorUnits(0), 0)
    assert.equal(toMajorUnits(99), 0.99)
    assert.equal(toMajorUnits(NaN), 0)
    assert.equal(toMajorUnits(Infinity), 0)
})

test("Discord Currency Formatter Resilience", () => {
    const usd = getCurrencyFormatter("USD")
    assert.ok(usd.format(100).includes("100"), "Formats USD")

    const inr = getCurrencyFormatter("inr")
    assert.ok(inr.format(100).includes("100"), "Handles lowercase INR")

    // Unknown/null currency code fallback (never throws)
    const fallback = getCurrencyFormatter(null)
    assert.ok(fallback.format(100), "Null code falls back without throwing")

    const invalid = getCurrencyFormatter("INVALID_CODE_XYZ")
    assert.ok(invalid.format(100), "Invalid code falls back without throwing")
})

test("Discord Content Escaping: Neutralize Mentions & Markdown Injection", () => {
    // Mentions neutralized with zero-width space
    assert.equal(discordEscape("@everyone"), "@\u200beveryone")
    assert.equal(discordEscape("@here"), "@\u200bhere")
    assert.equal(discordEscape("Hello @everyone in the channel"), "Hello @\u200beveryone in the channel")

    // Markdown escaping
    assert.equal(discordEscape("[Click Me](https://evil.com)"), "\\[Click Me\\]\\(https://evil.com\\)")
    assert.equal(discordEscape("**bold text**"), "\\*\\*bold text\\*\\*")
    assert.equal(discordEscape("*italic*"), "\\*italic\\*")
    assert.equal(discordEscape("_underline_"), "\\_underline\\_")
    assert.equal(discordEscape("`code`"), "\\`code\\`")

    // Safe handling of non-strings
    assert.equal(discordEscape(null), "")
    assert.equal(discordEscape(undefined), "")
    assert.equal(discordEscape(12345), "12345")
})

test("Discord Supported Events Matrix", () => {
    assert.ok(SUPPORTED_DISCORD_EVENTS.includes("order.placed"))
    assert.ok(SUPPORTED_DISCORD_EVENTS.includes("order.completed"))
    assert.ok(SUPPORTED_DISCORD_EVENTS.includes("order.canceled"))
    assert.ok(SUPPORTED_DISCORD_EVENTS.includes("payment.captured"))
    assert.ok(SUPPORTED_DISCORD_EVENTS.includes("fulfillment.shipment_created"))
})
