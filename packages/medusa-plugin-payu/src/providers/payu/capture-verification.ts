/**
 * Capture verification helpers.
 *
 * Deliberately free of any @medusajs/* import so the security-critical capture
 * decision can be unit tested without the framework runtime.
 */
import type { PayuCaptureVerification, PayuVerifyResponse } from "./types"

/**
 * Decide whether a payment session may be marked captured, based on the
 * gateway's verify response for the session's OWN txnid.
 *
 * `sessionAmount` is authoritative — it is read from the stored payment session,
 * not from the webhook — so a partial or mismatched settlement is rejected here
 * instead of being trusted.
 */
export function verifyCaptureEligibility(
    verifyResponse: PayuVerifyResponse | null | undefined,
    txnid: string | undefined,
    sessionAmount: string | undefined
): PayuCaptureVerification {
    if (!txnid) {
        return { ok: false, reason: "session is missing its PayU transaction id" }
    }

    if (!verifyResponse || verifyResponse.status !== 1) {
        return { ok: false, reason: "PayU did not confirm the transaction" }
    }

    const txn = verifyResponse.transaction_details?.[txnid]
    if (!txn || txn.status !== "success") {
        return { ok: false, reason: `PayU reports status "${txn?.status ?? "unknown"}"` }
    }

    // Compare in integer paise to avoid float drift.
    const paidPaise = Math.round(parseFloat(txn.amt ?? "NaN") * 100)
    const expectedPaise = Math.round(parseFloat(sessionAmount ?? "NaN") * 100)

    if (!Number.isFinite(paidPaise) || !Number.isFinite(expectedPaise)) {
        return { ok: false, reason: "unable to compare the settled and expected amounts" }
    }

    if (paidPaise < expectedPaise) {
        return { ok: false, reason: "PayU settled amount is lower than the payment session amount" }
    }

    return {
        ok: true,
        payuTransactionId: txn.mihpayid,
        paymentMode: txn.mode || "Online",
        bankRefNum: txn.bank_ref_num || "",
    }
}