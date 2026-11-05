import test from "node:test"
import assert from "node:assert/strict"
import { escapeHtml, escapeRegExp, isSafeWebUrl, resolveDataPath, sanitizeEmailAddress, sanitizeSenderName } from "../shared/mailer-runtime"
import { resolveTemplatePath, stripHtml } from "../shared/template-utils"
import { getActorId, isValidEmail, RateLimiter } from "../shared/http"
import { resolveNotificationSender } from "../shared/sender-config"

test("Mailer HTML Escaping & Injection Protection", () => {
    assert.equal(
        escapeHtml('<script>alert("xss")</script>'),
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    )
    assert.equal(
        escapeHtml("Hello 'World' & \"Friends\""),
        "Hello &#39;World&#39; &amp; &quot;Friends&quot;"
    )
    assert.equal(escapeHtml(null), "")
    assert.equal(escapeHtml(undefined), "")
    assert.equal(escapeHtml(12345), "12345")
})

test("Mailer URL Safety & Protocol Allowlist", () => {
    assert.equal(isSafeWebUrl("https://example.com/tracking/123"), true)
    assert.equal(isSafeWebUrl("http://example.com"), true)

    assert.equal(isSafeWebUrl("javascript:alert(1)"), false, "javascript: protocol blocked")
    assert.equal(isSafeWebUrl("data:text/html,<script>alert(1)</script>"), false, "data: protocol blocked")
    assert.equal(isSafeWebUrl("file:///etc/passwd"), false, "file: protocol blocked")
    assert.equal(isSafeWebUrl("not-a-url"), false)
    assert.equal(isSafeWebUrl(""), false)
})

test("Mailer Template Path Traversal Protection", () => {
    // Valid template name
    const valid = resolveTemplatePath("order_placed.html")
    assert.ok(valid && valid.endsWith("order_placed.html"), "Valid template resolves")

    // Path traversal attacks
    assert.equal(resolveTemplatePath("../../../etc/passwd"), null, "Path traversal with .. blocked")
    assert.equal(resolveTemplatePath("..\\..\\windows\\win.ini"), null, "Windows path traversal blocked")
    assert.equal(resolveTemplatePath("/etc/passwd"), null, "Absolute path blocked")
    assert.equal(resolveTemplatePath("malicious.sh"), null, "Non-html extensions blocked")
    assert.equal(resolveTemplatePath(""), null, "Empty template name blocked")
})

test("Mailer Data Path Resolution & Prototype Pollution Guards", () => {
    const data = {
        order: {
            id: "order_123",
            customer: {
                first_name: "John",
                email: "john@example.com",
            },
        },
    }

    assert.equal(resolveDataPath(data, "order.id"), "order_123")
    assert.equal(resolveDataPath(data, "order.customer.first_name"), "John")
    assert.equal(resolveDataPath(data, "order.customer.email"), "john@example.com")
    assert.equal(resolveDataPath(data, "order.nonexistent"), undefined)

    // Prototype pollution & constructor access blocked
    assert.equal(resolveDataPath(data, "__proto__.polluted"), undefined)
    assert.equal(resolveDataPath(data, "constructor.prototype"), undefined)
    assert.equal(resolveDataPath(data, "prototype"), undefined)
    assert.equal(resolveDataPath(data, "order; DROP TABLE"), undefined, "Special characters blocked")
})

test("Mailer Email & Sender Sanitization", () => {
    assert.equal(isValidEmail("user@example.com"), true)
    assert.equal(isValidEmail("user.name+tag@sub.example.com"), true)
    assert.equal(isValidEmail("invalid-email"), false)
    assert.equal(isValidEmail(""), false)
    assert.equal(isValidEmail(null as any), false)

    // Sender name sanitization (strips header injection CRLF)
    assert.equal(sanitizeSenderName("My Store"), "My Store")
    assert.equal(sanitizeSenderName("My Store\r\nBcc: evil@example.com"), "My Store Bcc: evil@example.com")

    // Email address sanitization
    assert.equal(sanitizeEmailAddress("  user@example.com  "), "user@example.com")
    assert.equal(sanitizeEmailAddress("user@example.com\r\n"), "user@example.com")
})

test("Mailer notification provider uses profile defaults with explicit compatibility precedence", () => {
    const profile = resolveNotificationSender({}, {
        MAILER_FROM_ADDRESS_1: "profile@example.com",
        MAILER_FROM_NAME_1: "Profile Sender",
        MAILER_SENDER_1_EMAIL: "legacy@example.com",
        MAILER_SENDER_1_NAME: "Legacy Sender",
        MAILER_SMTP_USER: "smtp@example.com",
    })
    assert.deepEqual(profile, { fromAddress: "profile@example.com", fromName: "Profile Sender" })

    const options = resolveNotificationSender({ fromEmail: "override@example.com", fromName: "Override" }, {
        MAILER_FROM_ADDRESS_1: "profile@example.com",
        MAILER_FROM_NAME_1: "Profile Sender",
    })
    assert.deepEqual(options, { fromAddress: "override@example.com", fromName: "Override" })

    const legacy = resolveNotificationSender({}, {
        MAILER_SENDER_1_EMAIL: "legacy@example.com",
        MAILER_SENDER_1_NAME: "Legacy Sender",
        MAILER_SMTP_USER: "smtp@example.com",
    })
    assert.deepEqual(legacy, { fromAddress: "legacy@example.com", fromName: "Legacy Sender" })
})

test("Mailer Admin Send Rate Limiter: caps per-actor sends", () => {
    // Bounds the manual-send endpoint so a leaked admin credential cannot use
    // the configured SMTP account as an open relay.
    const limiter = new RateLimiter(3, 60 * 1000)
    assert.equal(limiter.isAllowed("admin_1"), true, "1st send allowed")
    assert.equal(limiter.isAllowed("admin_1"), true, "2nd send allowed")
    assert.equal(limiter.isAllowed("admin_1"), true, "3rd send allowed")
    assert.equal(limiter.isAllowed("admin_1"), false, "4th send blocked")

    // Buckets are per-actor, so one admin cannot exhaust another's quota.
    assert.equal(limiter.isAllowed("admin_2"), true, "separate admin unaffected")
})

test("Mailer getActorId: prefers the authenticated actor over spoofable headers", () => {
    const req = {
        auth_context: { actor_id: "user_abc" },
        headers: { "x-forwarded-for": "9.9.9.9" },
        ip: "10.0.0.1",
    }
    assert.equal(getActorId(req), "user_abc", "authenticated actor must win")

    // Falls back to the socket address when no auth context is present.
    assert.equal(getActorId({ ip: "10.0.0.1" }), "10.0.0.1")
    assert.equal(getActorId({}), "unknown")
})

test("Mailer stripHtml Utility", () => {
    const html = "<p>Hello <b>World</b>!</p><style>.hide{display:none}</style><script>bad()</script>"
    const text = stripHtml(html)
    assert.ok(!text.includes("<"), "All tags stripped")
    assert.ok(text.includes("Hello"), "Preserves text content")
    assert.ok(!text.includes("bad()"), "Scripts removed")
    assert.ok(!text.includes("display:none"), "Styles removed")
})
