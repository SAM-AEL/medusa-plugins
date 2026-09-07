import test from "node:test"
import assert from "node:assert/strict"
import { isValidAwb } from "../shared/http"
import { isRetryableShiprocketStatus } from "../providers/shiprocket/client/config"
import { RateLimiter, getClientIdentifier } from "../api/store/shiprocket/delivery-estimate/rate-limiter"

test("Shiprocket AWB Validation", () => {
    // Valid standard numeric and alphanumeric AWBs
    assert.equal(isValidAwb("14325432423"), true)
    assert.equal(isValidAwb("SR12345678"), true)
    assert.equal(isValidAwb("AWB-987654321"), true)
    assert.equal(isValidAwb("123456"), true, "Minimum 6 chars")

    // Invalid AWBs
    assert.equal(isValidAwb("12345"), false, "Too short (<6)")
    assert.equal(isValidAwb(""), false, "Empty rejected")
    assert.equal(isValidAwb(null), false, "Null rejected")
    assert.equal(isValidAwb(undefined), false, "Undefined rejected")
    assert.equal(isValidAwb("AWB; DROP TABLE"), false, "Special chars rejected")
    assert.equal(isValidAwb("A".repeat(45)), false, "Too long (>40)")
})

test("Shiprocket Retryable Status Codes", () => {
    assert.equal(isRetryableShiprocketStatus(429), true, "429 Too Many Requests is retryable")
    assert.equal(isRetryableShiprocketStatus(500), true, "500 is retryable")
    assert.equal(isRetryableShiprocketStatus(502), true, "502 is retryable")
    assert.equal(isRetryableShiprocketStatus(503), true, "503 is retryable")
    assert.equal(isRetryableShiprocketStatus(504), true, "504 is retryable")

    assert.equal(isRetryableShiprocketStatus(200), false, "200 is not retryable")
    assert.equal(isRetryableShiprocketStatus(400), false, "400 is not retryable")
    assert.equal(isRetryableShiprocketStatus(401), false, "401 is not retryable")
    assert.equal(isRetryableShiprocketStatus(404), false, "404 is not retryable")
    assert.equal(isRetryableShiprocketStatus(422), false, "422 is not retryable")
})

test("Shiprocket Rate Limiter: Window Limiting and Reset", async () => {
    const limiter = new RateLimiter(3, 500) // 3 requests per 500ms window

    assert.equal(limiter.isAllowed("192.0.2.1"), true, "1st request allowed")
    assert.equal(limiter.isAllowed("192.0.2.1"), true, "2nd request allowed")
    assert.equal(limiter.isAllowed("192.0.2.1"), true, "3rd request allowed")
    assert.equal(limiter.isAllowed("192.0.2.1"), false, "4th request blocked by rate limit")

    // Different IP should have independent bucket
    assert.equal(limiter.isAllowed("192.0.2.2"), true, "Different IP allowed")

    // Wait for window expiration
    await new Promise(r => setTimeout(r, 600))

    assert.equal(limiter.isAllowed("192.0.2.1"), true, "Allowed again after window expiration")
})

test("Shiprocket Client Identifier: IP Resolution Priority", () => {
    // Framework-resolved direct IP takes precedence over spoofed forwarded headers
    const reqWithDirectAndSpoofed = {
        ip: "203.0.113.195",
        headers: {
            "x-forwarded-for": "198.51.100.1, 10.0.0.1",
            "x-real-ip": "198.51.100.2",
        },
    }
    assert.equal(getClientIdentifier(reqWithDirectAndSpoofed), "203.0.113.195")

    // Fallback to x-forwarded-for when direct IP is missing
    const reqForwardedOnly = {
        headers: {
            "x-forwarded-for": "198.51.100.10, 10.0.0.1",
        },
    }
    assert.equal(getClientIdentifier(reqForwardedOnly), "198.51.100.10")

    // Fallback to x-real-ip
    const reqRealIpOnly = {
        headers: {
            "x-real-ip": "198.51.100.20",
        },
    }
    assert.equal(getClientIdentifier(reqRealIpOnly), "198.51.100.20")

    // Unknown fallback
    const reqEmpty = { headers: {} }
    assert.equal(getClientIdentifier(reqEmpty), "unknown")
})
