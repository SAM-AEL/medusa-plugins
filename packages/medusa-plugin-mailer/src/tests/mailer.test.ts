import test from "node:test"
import assert from "node:assert/strict"
import { escapeHtml, escapeRegExp, isSafeWebUrl, resolveDataPath, sanitizeEmailAddress, sanitizeSenderName } from "../shared/mailer-runtime"
import { resolveTemplatePath, stripHtml } from "../shared/template-utils"
import { isValidEmail } from "../shared/http"

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

test("Mailer stripHtml Utility", () => {
    const html = "<p>Hello <b>World</b>!</p><style>.hide{display:none}</style><script>bad()</script>"
    const text = stripHtml(html)
    assert.ok(!text.includes("<"), "All tags stripped")
    assert.ok(text.includes("Hello"), "Preserves text content")
    assert.ok(!text.includes("bad()"), "Scripts removed")
    assert.ok(!text.includes("display:none"), "Styles removed")
})
