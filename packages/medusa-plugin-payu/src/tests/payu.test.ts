import test from "node:test"
import assert from "node:assert/strict"
import { PayuClient, generateTxnId } from "../providers/payu/client"
import { sanitizeIndianPhone, isValidIndianPhone } from "../providers/payu/phone-utils"
import { isRetryablePayuStatus } from "../providers/payu/config"

const TEST_KEY = "test_merchant_key_123"
const TEST_SALT = "test_merchant_salt_456"

test("PayU Client: Transaction ID Generation", () => {
    for (let i = 0; i < 50; i++) {
        const txnid = generateTxnId()
        assert.ok(txnid.length <= 25, `txnid length ${txnid.length} exceeds 25 chars: ${txnid}`)
        assert.ok(/^[A-Za-z0-9_-]+$/.test(txnid), `txnid contains invalid characters: ${txnid}`)
        assert.ok(txnid.startsWith("T"), `txnid should start with T prefix: ${txnid}`)
    }
})

test("PayU Client: Payment Hash Generation and Verification Roundtrip", () => {
    const client = new PayuClient({
        merchantKey: TEST_KEY,
        merchantSalt: TEST_SALT,
        environment: "test",
    })

    const paymentData = {
        txnid: "T_TEST_12345",
        amount: "500.00",
        productinfo: "Medusa Test Product",
        firstname: "John",
        email: "john.doe@example.com",
        udf1: "meta1",
        udf2: "meta2",
        udf3: "session_abc",
        udf4: "500.00",
        udf5: "custom",
    }

    const hash = client.generatePaymentHash(paymentData)
    assert.ok(hash && typeof hash === "string", "Hash should be generated")
    assert.equal(hash.length, 128, "SHA-512 hex hash must be 128 chars")

    // Verify reverse hash response
    const isValid = client.verifyResponseHash({
        status: "success",
        email: paymentData.email,
        firstname: paymentData.firstname,
        productinfo: paymentData.productinfo,
        amount: paymentData.amount,
        txnid: paymentData.txnid,
        hash: client.calculateResponseHash({
            status: "success",
            email: paymentData.email,
            firstname: paymentData.firstname,
            productinfo: paymentData.productinfo,
            amount: paymentData.amount,
            txnid: paymentData.txnid,
            udf1: paymentData.udf1,
            udf2: paymentData.udf2,
            udf3: paymentData.udf3,
            udf4: paymentData.udf4,
            udf5: paymentData.udf5,
        }),
        udf1: paymentData.udf1,
        udf2: paymentData.udf2,
        udf3: paymentData.udf3,
        udf4: paymentData.udf4,
        udf5: paymentData.udf5,
    })

    assert.equal(isValid, true, "Calculated response hash must verify successfully")
})

test("PayU Client: Tampered Payload Hash Rejection", () => {
    const client = new PayuClient({
        merchantKey: TEST_KEY,
        merchantSalt: TEST_SALT,
        environment: "test",
    })

    const originalData = {
        status: "success",
        email: "alice@example.com",
        firstname: "Alice",
        productinfo: "Order 101",
        amount: "1200.00",
        txnid: "TXN_SAFE_001",
        udf3: "session_123",
        udf4: "1200.00",
    }

    const validHash = client.calculateResponseHash(originalData)

    // Tamper with amount
    const tamperedAmountValid = client.verifyResponseHash({
        ...originalData,
        amount: "1.00",
        hash: validHash,
    })
    assert.equal(tamperedAmountValid, false, "Tampered amount must fail hash check")

    // Tamper with status
    const tamperedStatusValid = client.verifyResponseHash({
        ...originalData,
        status: "failure",
        hash: validHash,
    })
    assert.equal(tamperedStatusValid, false, "Tampered status must fail hash check")

    // Tamper with session udf3
    const tamperedUdfValid = client.verifyResponseHash({
        ...originalData,
        udf3: "session_attacker",
        hash: validHash,
    })
    assert.equal(tamperedUdfValid, false, "Tampered udf3 must fail hash check")
})

test("PayU Client: additionalCharges Handling in Reverse Hash", () => {
    const client = new PayuClient({
        merchantKey: TEST_KEY,
        merchantSalt: TEST_SALT,
        environment: "test",
    })

    const payloadWithCharges = {
        status: "success",
        email: "bob@example.com",
        firstname: "Bob",
        productinfo: "Order 102",
        amount: "2000.00",
        txnid: "TXN_SAFE_002",
        additionalCharges: "50.00",
    }

    const hash = client.calculateResponseHash(payloadWithCharges)
    assert.ok(hash, "Should calculate response hash with additionalCharges")

    const verified = client.verifyResponseHash({
        ...payloadWithCharges,
        hash,
    })
    assert.equal(verified, true, "Reverse hash with additionalCharges must verify")
})

test("PayU Phone Utils: Indian Phone Number Normalization", () => {
    // Valid phone numbers
    assert.equal(sanitizeIndianPhone("9876543210"), "9876543210")
    assert.equal(sanitizeIndianPhone("+919876543210"), "9876543210")
    assert.equal(sanitizeIndianPhone("+91 98765-43210"), "9876543210")
    assert.equal(sanitizeIndianPhone("09876543210"), "9876543210")
    assert.equal(sanitizeIndianPhone("8123456789"), "8123456789")
    assert.equal(sanitizeIndianPhone("7000000001"), "7000000001")
    assert.equal(sanitizeIndianPhone("6999999999"), "6999999999")
    assert.equal(isValidIndianPhone("+91 98765-43210"), true)

    // Invalid phone numbers
    assert.equal(sanitizeIndianPhone("1234567890"), null, "Must start with 6-9")
    assert.equal(sanitizeIndianPhone("987654321"), null, "Must be 10 digits")
    assert.equal(sanitizeIndianPhone("98765432100"), null, "Must not exceed 10 digits")
    assert.equal(sanitizeIndianPhone("abcdefghij"), null, "Non-digits rejected")
    assert.equal(sanitizeIndianPhone(""), null, "Empty string rejected")
    assert.equal(isValidIndianPhone("12345"), false)
})

test("PayU Config: Retryable Status Verification", () => {
    assert.equal(isRetryablePayuStatus(429), true, "429 Too Many Requests is retryable")
    assert.equal(isRetryablePayuStatus(500), true, "500 Internal Error is retryable")
    assert.equal(isRetryablePayuStatus(502), true, "502 Bad Gateway is retryable")
    assert.equal(isRetryablePayuStatus(503), true, "503 Service Unavailable is retryable")
    assert.equal(isRetryablePayuStatus(504), true, "504 Gateway Timeout is retryable")

    assert.equal(isRetryablePayuStatus(200), false, "200 is not retryable")
    assert.equal(isRetryablePayuStatus(400), false, "400 Bad Request is not retryable")
    assert.equal(isRetryablePayuStatus(401), false, "401 Unauthorized is not retryable")
    assert.equal(isRetryablePayuStatus(403), false, "403 Forbidden is not retryable")
    assert.equal(isRetryablePayuStatus(404), false, "404 Not Found is not retryable")
})
