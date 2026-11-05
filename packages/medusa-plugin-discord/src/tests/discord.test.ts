import test from "node:test"
import assert from "node:assert/strict"
import {
    normalizeWebhookUrl,
    isValidWebhookUrl,
    DISCORD_EVENTS,
    SUPPORTED_DISCORD_EVENTS,
    DISCORD_SUBSCRIBER_CONFIG,
    toMajorUnits,
    getCurrencyFormatter,
    discordEscape
} from "../shared/discord-fields"
import { maskWebhookUrl, toSafeMapping, RateLimiter } from "../shared/http"

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

test("Discord event allowlist matches subscriber-supported events", () => {
    assert.deepEqual(DISCORD_EVENTS, SUPPORTED_DISCORD_EVENTS)
    assert.deepEqual(DISCORD_SUBSCRIBER_CONFIG.event, DISCORD_EVENTS)
    for (const event of ["order.placed", "payment.captured", "payment.refunded", "shipment.created"]) {
        assert.ok(DISCORD_EVENTS.includes(event as (typeof DISCORD_EVENTS)[number]))
    }
    for (const event of ["return.created", "claim.created", "exchange.created", "order.unrecognized"]) {
        assert.equal(DISCORD_EVENTS.includes(event as (typeof DISCORD_EVENTS)[number]), false)
    }
})

test("Discord 2.0: maskWebhookUrl never leaks the bearer token", () => {
    const url = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_123456"
    const masked = maskWebhookUrl(url)
    assert.ok(!masked.includes("AbCdEfGhIjKlMnOpQrStUvWxYz"), "full token must not appear")
    assert.ok(masked.includes("…3456"), "last4 retained for identification")
    assert.ok(masked.startsWith("https://discord.com/api/webhooks/123456789012345678/"))
    assert.equal(maskWebhookUrl("not-a-url"), "…invalid")
    const safe = toSafeMapping({ id: "m1", event_name: "order.placed", webhook_url: url })
    assert.equal((safe as any).webhook_url, undefined, "raw URL stripped")
    assert.equal((safe as any).masked_url, masked)
    const rl = new RateLimiter(2, 60 * 1000)
    assert.equal(rl.isAllowed("actor:m1"), true)
    assert.equal(rl.isAllowed("actor:m1"), true)
    assert.equal(rl.isAllowed("actor:m1"), false, "third ping within window is throttled")
})
