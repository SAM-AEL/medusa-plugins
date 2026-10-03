import test from "node:test"
import assert from "node:assert/strict"
import { maskPhone, normalizePhoneToE164, normalizeTemplateVariables } from "../shared/http"
import { redactSensitiveObject } from "../shared/log-policy"
import { resolveDataPath } from "../shared/whatsapp-runtime"

test("WhatsApp Phone Normalization: E.164 Strict Parsing", () => {
    // Valid standard and formatted phone numbers
    assert.equal(normalizePhoneToE164("+91 98765-43210"), "919876543210")
    assert.equal(normalizePhoneToE164("+1 (555) 123-4567"), "15551234567")
    assert.equal(normalizePhoneToE164("919876543210"), "919876543210")
    assert.equal(normalizePhoneToE164("447911123456"), "447911123456")
    assert.equal(normalizePhoneToE164("+49 30 123456"), "4930123456")

    // Invalid phone numbers
    assert.equal(normalizePhoneToE164("12345"), null, "Too short (<8 digits)")
    assert.equal(normalizePhoneToE164("1234567890123456"), null, "Too long (>15 digits)")
    assert.equal(normalizePhoneToE164("09876543210"), null, "Leading zero country code invalid")
    assert.equal(normalizePhoneToE164("abc1234567890"), null, "Alphabetic characters rejected")
    assert.equal(normalizePhoneToE164(""), null, "Empty string rejected")
    assert.equal(normalizePhoneToE164(null), null, "Null rejected")
})

test("WhatsApp Phone Masking: subscriber digits are never leaked", () => {
    // The country prefix and last 4 digits are preserved for operator usability.
    assert.equal(maskPhone("+919876543210"), "+91 ****** 3210")
    assert.equal(maskPhone("+1 5551234567"), "+1 ****** 4567")

    // The critical property: no more than the last 4 digits survive, and the
    // middle of the number is always replaced.
    assert.ok(!maskPhone("+919876543210").includes("98765"), "leading subscriber digits must be masked")
    assert.ok(!maskPhone("919876543210").includes("9876543"), "leading subscriber digits must be masked")

    // Degenerate / hostile inputs must not throw or leak structure.
    assert.equal(maskPhone(""), "")
    assert.equal(maskPhone(null), "")
    assert.equal(maskPhone(undefined), "")
    assert.equal(maskPhone(1234567890), "", "non-string input rejected")

    // Short values are fully starred rather than partially revealed.
    const short = maskPhone("+9112")
    assert.ok(!short.includes("12"), "short numbers must not reveal trailing digits")
})

test("WhatsApp Log Redaction Policy: Sensitive Keys Masking", () => {
    const rawPayload = {
        messaging_product: "whatsapp",
        to: "919876543210",
        recipient_phone: "919876543210",
        template: {
            name: "order_confirmed",
            language: { code: "en_US" },
        },
        access_token: "EAABtesttoken123456",
        authorization: "Bearer secret",
        customer: {
            phone: "+919876543210",
            email: "alice@example.com",
            password: "supersecretpassword",
        },
    }

    const redacted = redactSensitiveObject(rawPayload)

    assert.equal(redacted.to, "[REDACTED]")
    assert.equal(redacted.recipient_phone, "[REDACTED]")
    assert.equal(redacted.access_token, "[REDACTED]")
    assert.equal(redacted.authorization, "[REDACTED]")
    assert.equal((redacted.customer as any).phone, "[REDACTED]")
    assert.equal((redacted.customer as any).password, "[REDACTED]")

    // Non-sensitive data remains intact
    assert.equal(redacted.messaging_product, "whatsapp")
    assert.equal((redacted.customer as any).email, "alice@example.com")
})

test("WhatsApp Data Path Traversal Security", () => {
    const context = {
        order: {
            display_id: 1042,
            shipping_address: {
                city: "Mumbai",
                province: "MH",
            },
        },
    }

    assert.equal(resolveDataPath(context, "order.display_id"), 1042)
    assert.equal(resolveDataPath(context, "order.shipping_address.city"), "Mumbai")
    assert.equal(resolveDataPath(context, "order.shipping_address.zip"), undefined)

    // Security: prototype pollution and function execution prevented
    assert.equal(resolveDataPath(context, "__proto__.polluted"), undefined)
    assert.equal(resolveDataPath(context, "constructor.prototype"), undefined)
    assert.equal(resolveDataPath(context, "order.shipping_address; alert()"), undefined)
})

test("WhatsApp Template Variable Normalization", () => {
    const vars = {
        "1": "John",
        "2": "Order #1234",
        "invalid-key!": "should be skipped",
        "3": 500,
    }

    const normalized = normalizeTemplateVariables(vars)

    assert.equal(normalized["1"], "John")
    assert.equal(normalized["2"], "Order #1234")
    assert.equal(normalized["3"], "500")
    assert.equal(normalized["invalid-key!"], undefined, "Keys with special chars dropped")
})
