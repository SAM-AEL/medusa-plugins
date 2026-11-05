import test from "node:test"
import assert from "node:assert/strict"
import { PayuClient, generateTxnId } from "../providers/payu/client"
import { sanitizeIndianPhone, isValidIndianPhone } from "../providers/payu/phone-utils"
import { isRetryablePayuStatus } from "../providers/payu/config"
import { verifyCaptureEligibility } from "../providers/payu/capture-verification"
import { markRefundSucceeded, reserveRefund } from "../providers/payu/refund-ledger"

const TEST_KEY = "example_merchant_key"
const TEST_SALT = "example_merchant_salt"

class RefundLedgerRedisMock {
    operations = new Map<string, { payment_id: string; amount_paise: string; token_id: string; state: string; request_id?: string }>()
    totals = new Map<string, number>()
    private sequence = 0

    async eval(_script: string, keyCount: number, ...args: string[]) {
        if (keyCount === 1) {
            const [operationKey, requestId] = args
            const operation = this.operations.get(operationKey)
            if (!operation) return 0
            operation.state = "succeeded"
            operation.request_id = requestId
            return 1
        }
        if (keyCount === 2) {
            const [operationKey, totalKey, paymentId, amountPaise, capturedPaise, alreadyRefundedPaise, tokenCandidate] = args
            const existing = this.operations.get(operationKey)
            if (existing) {
                if (existing.payment_id !== paymentId || existing.amount_paise !== amountPaise) return ["conflict"]
                return [existing.token_id, existing.state, existing.request_id || "", "0", existing.amount_paise]
            }
            const total = this.totals.get(totalKey) ?? Number(alreadyRefundedPaise)
            if (total + Number(amountPaise) > Number(capturedPaise)) return ["exceeds_balance"]
            const token = tokenCandidate || `REF_${++this.sequence}`
            this.operations.set(operationKey, { payment_id: paymentId, amount_paise: amountPaise, token_id: token, state: "pending" })
            this.totals.set(totalKey, total + Number(amountPaise))
            return [token, "pending", "", "1"]
        }
        throw new Error("unexpected eval")
    }
}

test("PayU refund ledger reuses reservations and rejects idempotency conflicts", async () => {
    const redis = new RefundLedgerRedisMock()
    const first = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-1",
        idempotencyKey: "refund-1",
        amountPaise: 2500,
        capturedPaise: 10000,
    })
    const retry = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-1",
        idempotencyKey: "refund-1",
        amountPaise: 2500,
        capturedPaise: 10000,
    })
    assert.equal(first.created, true)
    assert.equal(retry.created, false)
    assert.equal(retry.tokenId, first.tokenId)
    await markRefundSucceeded({ redis, paymentTransactionId: "mihpayid-1", idempotencyKey: "refund-1", requestId: "request-1" })
    const completedRetry = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-1",
        idempotencyKey: "refund-1",
        amountPaise: 2500,
        capturedPaise: 10000,
    })
    assert.equal(completedRetry.state, "succeeded")
    assert.equal(completedRetry.requestId, "request-1")
    await assert.rejects(
        reserveRefund({ redis, paymentTransactionId: "mihpayid-1", idempotencyKey: "refund-1", amountPaise: 3000, capturedPaise: 10000 }),
        /different refund/
    )
})

test("PayU refund ledger keeps unknown operations pending for reconciliation", async () => {
    const redis = new RefundLedgerRedisMock()
    const first = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-unknown",
        idempotencyKey: "refund-unknown",
        amountPaise: 1000,
        capturedPaise: 10000,
    })
    const retry = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-unknown",
        idempotencyKey: "refund-unknown",
        amountPaise: 1000,
        capturedPaise: 10000,
    })
    assert.equal(first.state, "pending")
    assert.equal(retry.state, "pending")
    assert.equal(retry.created, false)
    assert.equal(retry.tokenId, first.tokenId)
})

test("PayU refund ledger counts existing session refunds and validates stable keys", async () => {
    const redis = new RefundLedgerRedisMock()
    const reservation = await reserveRefund({
        redis,
        paymentTransactionId: "mihpayid-legacy",
        idempotencyKey: "refund-new",
        amountPaise: 1000,
        capturedPaise: 5000,
        alreadyRefundedPaise: 4000,
    })
    assert.equal(reservation.created, true)
    await assert.rejects(
        reserveRefund({ redis, paymentTransactionId: "mihpayid-other", idempotencyKey: "bad key", amountPaise: 100, capturedPaise: 1000 }),
        /valid context.idempotency_key/
    )
})

test("PayU refund ledger atomically prevents concurrent over-refunds", async () => {
    const redis = new RefundLedgerRedisMock()
    const results = await Promise.allSettled([
        reserveRefund({ redis, paymentTransactionId: "mihpayid-2", idempotencyKey: "refund-a", amountPaise: 7000, capturedPaise: 10000 }),
        reserveRefund({ redis, paymentTransactionId: "mihpayid-2", idempotencyKey: "refund-b", amountPaise: 7000, capturedPaise: 10000 }),
    ])
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
    assert.equal(results.filter((result) => result.status === "rejected").length, 1)
})

test("PayU Capture: rejects a settled amount below the session amount", () => {
    // Session (authoritative, DB-backed) expects 5000.00 but PayU only settled
    // 1.00. This is the underpayment scenario and must never be capturable.
    const verdict = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_ATTACK: { status: "success", amt: "1.00" } } } as any,
        "T_ATTACK",
        "5000.00"
    )
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /lower than the payment session amount/)
})

test("PayU Capture: rejects when PayU does not report success", () => {
    const verdict = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_PENDING: { status: "pending", amt: "500.00" } } } as any,
        "T_PENDING",
        "500.00"
    )
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /status "pending"/)
})

test("PayU Capture: rejects an unconfirmed txnid (cross-session attack)", () => {
    // An attacker pointing their session at someone else's txnid: the verify
    // API knows nothing about it, so it must not capture.
    const verdict = verifyCaptureEligibility({ status: 1, transaction_details: {} } as any, "T_VICTIM", "500.00")
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /status "unknown"/)
})

test("PayU Capture: rejects when the gateway does not confirm at all", () => {
    const verdict = verifyCaptureEligibility({ status: 0, transaction_details: {} } as any, "T_X", "500.00")
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /did not confirm/)

    assert.equal(verifyCaptureEligibility(null, "T_X", "500.00").ok, false, "null response fails closed")
    assert.equal(verifyCaptureEligibility(undefined, "T_X", "500.00").ok, false, "undefined response fails closed")
})

test("PayU Capture: rejects a session with no txnid (fails closed)", () => {
    const verdict = verifyCaptureEligibility({ status: 1, transaction_details: {} } as any, undefined, "500.00")
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /missing its PayU transaction id/)
})

test("PayU Capture: rejects non-numeric amounts rather than defaulting", () => {
    const verdict = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_N: { status: "success", amt: "not-a-number" } } } as any,
        "T_N",
        "500.00"
    )
    assert.equal(verdict.ok, false)
    assert.match(verdict.reason!, /unable to compare/)
})

test("PayU Capture: accepts an exactly settled amount", () => {
    const verdict = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_GOOD: { status: "success", amt: "500.00", mihpayid: "M3", bank_ref_num: "BR3", mode: "CC" } } } as any,
        "T_GOOD",
        "500.00"
    )
    assert.equal(verdict.ok, true)
    assert.equal(verdict.bankRefNum, "BR3")
    assert.equal(verdict.payuTransactionId, "M3")
})

test("PayU Capture: accepts an overpayment", () => {
    const verdict = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_OVER: { status: "success", amt: "600.00" } } } as any,
        "T_OVER",
        "500.00"
    )
    assert.equal(verdict.ok, true, "paying more than the session amount is fine")
})

test("PayU Capture: rounds to whole paise so float drift cannot underpay", () => {
    // 499.999 rounds UP to 50000 paise, i.e. exactly the session amount. Sub-paise
    // noise must not be treated as an underpayment.
    const roundsUp = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_DRIFT: { status: "success", amt: "499.999" } } } as any,
        "T_DRIFT",
        "500.00"
    )
    assert.equal(roundsUp.ok, true, "sub-paise drift must not count as an underpayment")

    // A genuine half-rupee shortfall must still be rejected.
    const genuineShortfall = verifyCaptureEligibility(
        { status: 1, transaction_details: { T_SHORT: { status: "success", amt: "499.49" } } } as any,
        "T_SHORT",
        "500.00"
    )
    assert.equal(genuineShortfall.ok, false, "a real shortfall of 51 paise must be rejected")
})

test("PayU Capture: ignores an amount supplied for a different txnid", () => {
    // The session amount must be compared against ITS OWN txnid, never one the
    // attacker controls.
    const verdict = verifyCaptureEligibility(
        {
            status: 1,
            transaction_details: {
                T_MINE: { status: "success", amt: "1.00" },
                T_OTHER: { status: "success", amt: "99999.00" },
            },
        } as any,
        "T_MINE",
        "500.00"
    )
    assert.equal(verdict.ok, false, "must compare against the session's own txnid")
})

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
        productinfo: "Test Product",
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
