/**
 * PayU Payment Provider Service
 * MedusaJS 2 Payment Provider for PayU India
 * 
 * Implements redirect-based payment flow using official payu-websdk
 */

import {
    AbstractPaymentProvider,
    BigNumber,
    MedusaError,
    PaymentSessionStatus,
} from "@medusajs/framework/utils"
import type {
    InitiatePaymentInput,
    InitiatePaymentOutput,
    AuthorizePaymentInput,
    AuthorizePaymentOutput,
    CapturePaymentInput,
    CapturePaymentOutput,
    RefundPaymentInput,
    RefundPaymentOutput,
    CancelPaymentInput,
    CancelPaymentOutput,
    DeletePaymentInput,
    DeletePaymentOutput,
    GetPaymentStatusInput,
    GetPaymentStatusOutput,
    RetrievePaymentInput,
    RetrievePaymentOutput,
    UpdatePaymentInput,
    UpdatePaymentOutput,
    ProviderWebhookPayload,
    WebhookActionResult,
    Logger,
} from "@medusajs/framework/types"

import type { PayuProviderConfig, PayuSessionData, PayuWebhookPayload, PayuPaymentStatus } from "./types"
import { PayuClient, generateTxnId } from "./client"
import { verifyCaptureEligibility } from "./capture-verification"
import { sanitizeIndianPhone } from "./phone-utils"
import { markRefundSucceeded, releaseRefund, reserveRefund } from "./refund-ledger"
import crypto from "crypto"

export const PAYU_PROVIDER_ID = "payu"

/**
 * PayU Payment Provider Service
 * 
 * Flow:
 * 1. initiatePayment - Returns session data with payment URL and form data
 * 2. Frontend redirects customer to PayU checkout
 * 3. Customer completes payment on PayU
 * 4. PayU redirects back and sends webhook
 * 5. authorizePayment - Verifies and marks payment as authorized
 */
class PayuPaymentProviderService extends AbstractPaymentProvider<PayuProviderConfig> {
    static identifier = PAYU_PROVIDER_ID
    private static readonly webhookReplayCache = new Map<string, number>()
    private static readonly webhookReplayTtlMs = 10 * 60 * 1000
    private static redisClient: any = null

    /**
     * Validate provider options at startup
     * Called by MedusaJS when registering the provider
     */
    static validateOptions(options: Record<string, unknown>): void {
        if (!options.merchantKey) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "PayU: merchantKey is required. Set PAYU_MERCHANT_KEY environment variable."
            )
        }
        if (!options.merchantSalt) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "PayU: merchantSalt is required. Set PAYU_MERCHANT_SALT environment variable."
            )
        }
        const environment = options.environment ?? process.env.PAYU_ENVIRONMENT ?? "test"
        if (environment === "production" && !process.env.REDIS_URL) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                "PayU: REDIS_URL is required in production for webhook replay protection. " +
                "Without it, deduplication degrades to per-process memory."
            )
        }
    }

    protected config_: PayuProviderConfig
    protected logger_: Logger
    protected client_: PayuClient

    private async getRedisClient(): Promise<any> {
        const redisUrl = process.env.REDIS_URL
        if (!redisUrl) throw new Error("REDIS_URL is required for PayU production safety")
        if (!PayuPaymentProviderService.redisClient) {
            const ioredisModule: any = await import("ioredis")
            const Redis = ioredisModule?.default?.default ?? ioredisModule?.default ?? ioredisModule
            if (typeof Redis !== "function") throw new Error("ioredis did not resolve to a constructor")
            PayuPaymentProviderService.redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true })
        }
        return PayuPaymentProviderService.redisClient
    }

    private async markWebhookProcessed(key: string): Promise<boolean> {
        if (this.config_.environment === "production" || process.env.REDIS_URL) {
            const redis = await this.getRedisClient()
            const result = await redis.set(
                `payu_webhook:${key}`,
                "1",
                "EX",
                Math.ceil(PayuPaymentProviderService.webhookReplayTtlMs / 1000),
                "NX"
            )
            return result === "OK"
        }

        const MAX_CACHE_SIZE = 10000
        const now = Date.now()
        // Opportunistic expiry sweep (cheap: only when oversized or ~1% of calls)
        if (
            PayuPaymentProviderService.webhookReplayCache.size > MAX_CACHE_SIZE ||
            Math.random() < 0.01
        ) {
            for (const [cacheKey, expiresAt] of PayuPaymentProviderService.webhookReplayCache.entries()) {
                if (expiresAt <= now) {
                    PayuPaymentProviderService.webhookReplayCache.delete(cacheKey)
                }
                if (PayuPaymentProviderService.webhookReplayCache.size <= MAX_CACHE_SIZE) {
                    break
                }
            }
        }

        if (PayuPaymentProviderService.webhookReplayCache.has(key)) {
            return false
        }

        if (PayuPaymentProviderService.webhookReplayCache.size >= MAX_CACHE_SIZE) {
            // Fail-open rather than OOM: evict oldest entry (Map preserves insertion order)
            const oldest = PayuPaymentProviderService.webhookReplayCache.keys().next()
            if (!oldest.done) {
                PayuPaymentProviderService.webhookReplayCache.delete(oldest.value)
            }
        }

        PayuPaymentProviderService.webhookReplayCache.set(
            key,
            now + PayuPaymentProviderService.webhookReplayTtlMs
        )
        return true
    }

    constructor(container: Record<string, unknown>, config: PayuProviderConfig) {
        super(container, config)

        if (!config.merchantKey || !config.merchantSalt) {
            throw new Error(
                "PayU: merchantKey and merchantSalt are required. " +
                "Set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT environment variables."
            )
        }

        this.config_ = {
            merchantKey: config.merchantKey,
            merchantSalt: config.merchantSalt,
            environment: config.environment || "test",
            autoCapture: config.autoCapture ?? true,
        }

        this.logger_ = container.logger as Logger
        this.client_ = new PayuClient(this.config_, this.logger_)

        this.logger_?.info?.(`PayU initialized in ${this.config_.environment} mode`)
    }

    /**
     * Format amount to string with 2 decimals (PayU requirement).
     * Amounts are expected in major units (rupees). Throws on invalid input
     * instead of propagating "NaN" into hashes / PayU requests.
     */
    private formatAmount(amount: any): string {
        let num: number
        if (typeof amount === "string") {
            num = parseFloat(amount)
        } else if (typeof amount === "number") {
            num = amount
        } else if (amount && typeof amount.toNumber === 'function') {
            // Handle BigNumber or custom objects
            num = amount.toNumber()
        } else if (amount && typeof amount === 'object' && 'value' in amount) {
            // Handle serialized BigNumber: { value: "155.82", precision: 20 }
            num = parseFloat(amount.value)
        } else {
            num = Number(amount)
        }
        if (!Number.isFinite(num) || num <= 0) {
            throw new MedusaError(
                MedusaError.Types.INVALID_DATA,
                `Invalid amount: ${String(amount)}`
            )
        }
        return num.toFixed(2)
    }

    /**
     * Initiate payment session
     */
    async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
        const { amount, context } = input

        try {
            const txnid = generateTxnId()
            const formattedAmount = this.formatAmount(amount)

            // Debug logging for amount calculation
            this.logger_?.debug?.(`PayU initiatePayment amount=${formattedAmount}`)

            const customer = context?.customer
            const inputData = input.data as Record<string, unknown> | undefined

            // Medusa passes the session_id via input.data.session_id, which we echo back in
            // udf3 so webhooks can be correlated back to the payment session.
            // The value originates from the caller, so validate its shape: a
            // non-UUID here would later be trusted as a session identifier.
            // Fail closed rather than silently proceeding with a bogus value.
            const rawSessionId = (inputData?.session_id as string) || ""
            if (rawSessionId && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(rawSessionId)) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "Invalid payment session_id: expected a UUID"
                )
            }
            const sessionId = rawSessionId

            const sanitizeHashField = (v: unknown, maxLen: number): string =>
                String(v ?? "").replace(/[\r\n|]/g, " ").trim().slice(0, maxLen)
            const email = sanitizeHashField(customer?.email || (inputData?.email as string), 100)
            const firstname = sanitizeHashField(customer?.first_name || (inputData?.firstname as string) || (inputData?.first_name as string), 60)
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error("Customer email is required for payment processing. Pass email in data payload or ensure customer is logged in.")
            }

            if (!firstname) {
                throw new Error("Customer name is required for payment processing. Pass firstname in data payload.")
            }

            // Fallback chain for phone: customer phone -> billing address phone -> shipping address phone -> input data
            // Then sanitize to 10-digit Indian format (strips +91, 91, 0091, 0 prefixes)
            const rawPhone = customer?.phone
                || customer?.billing_address?.phone
                || (inputData?.shipping_address_phone as string)
                || (inputData?.phone as string)

            const phone = sanitizeIndianPhone(rawPhone)
            if (!phone) {
                throw new Error(
                    "Valid phone number (at least 10 digits) is required for payment processing. " +
                    "Pass phone in data payload or ensure shipping/billing address has a valid phone."
                )
            }

            const rawProductinfo = (inputData?.productinfo as string) || "Order Payment"
            // PayU hash uses "|" as delimiter: strip pipes/newlines and cap length
            // so hash inputs stay well-formed and PayU validation is not broken.
            const productinfo = sanitizeHashField(rawProductinfo, 100) || "Order Payment"
            const cartId = sanitizeHashField((inputData?.cart_id as string) || "", 100)
            const customerId = sanitizeHashField(context?.customer?.id || (inputData?.customer_id as string) || "", 100)

            this.logger_?.debug?.(`PayU initiatePayment - sessionId from Medusa: ${sessionId}`)

            // Build redirect URLs from environment variables
            // Allow NEXT_PUBLIC_BASE_URL as fallback for STOREFRONT_URL
            const storefrontUrl = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL

            // Provide sensible defaults if specific paths aren't provided
            const redirectPath = process.env.PAYU_REDIRECT_URL || "/order/confirmed"
            const redirectFailurePath = process.env.PAYU_REDIRECT_FAILURE_URL || "/checkout"

            if (!storefrontUrl) {
                throw new Error("STOREFRONT_URL or NEXT_PUBLIC_BASE_URL environment variable is required")
            }

            let storefrontOrigin: string
            try {
                const parsed = new URL(storefrontUrl)
                if (parsed.protocol !== "https:" && this.config_.environment === "production") {
                    throw new Error("STOREFRONT_URL must use https in production")
                }
                if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
                    throw new Error("STOREFRONT_URL must be an http(s) URL")
                }
                storefrontOrigin = parsed.origin
            } catch (e) {
                if (e instanceof MedusaError) throw e
                throw new Error("STOREFRONT_URL must be a valid absolute URL")
            }

            const rawCountry = (inputData?.country_code as string) || "in"
            const countryCode = /^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toLowerCase() : "in"

            // Constructs the URL: {origin}/{country}/{path}
            const cleanBase = storefrontOrigin.replace(/\/$/, "")
            const cleanPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`
            const cleanFailPath = redirectFailurePath.startsWith("/") ? redirectFailurePath : `/${redirectFailurePath}`

            const surl = `${cleanBase}/${countryCode}${cleanPath}`
            const furl = `${cleanBase}/${countryCode}${cleanFailPath}`

            // Generate hash using SDK (includes UDF fields)
            const hash = this.client_.generatePaymentHash({
                txnid,
                amount: formattedAmount,
                productinfo,
                firstname,
                email,
                udf1: cartId,
                udf2: customerId,
                udf3: sessionId,
                udf4: formattedAmount, // Store expected amount for webhook validation
            })

            const sessionData: PayuSessionData = {
                txnid,
                amount: formattedAmount,
                productinfo,
                firstname,
                email,
                phone,
                hash,
                paymentUrl: this.client_.getPaymentUrl(),
                status: "pending",
                countryCode,
                udf1: cartId,
                udf2: customerId,
                udf3: sessionId,
                udf4: formattedAmount,
            }

            this.logger_?.debug?.(`PayU payment initiated: ${txnid}`)

            return {
                id: txnid,
                data: {
                    ...sessionData,
                    form_data: {
                        key: this.config_.merchantKey,
                        txnid,
                        amount: formattedAmount,
                        productinfo,
                        firstname,
                        email,
                        phone,
                        surl,
                        furl,
                        hash,
                        udf1: cartId,
                        udf2: customerId,
                        udf3: sessionId,
                        udf4: formattedAmount,
                        service_provider: "payu_paisa",
                    },
                } as unknown as Record<string, unknown>,
            }
        } catch (error) {
            this.logger_?.error?.(`PayU initiatePayment error: ${error instanceof Error ? error.message : "unknown"}`)
            throw error
        }
    }

    /**
     * Authorize payment after PayU callback
     */
    async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
        try {
            const sessionData = input.data as unknown as PayuSessionData

            if (sessionData.status === "authorized" || sessionData.status === "captured") {
                return {
                    status: PaymentSessionStatus.AUTHORIZED,
                    data: input.data,
                }
            }

            const response = await this.client_.verifyPayment(sessionData.txnid)

            if (response.status === 1) {
                const txn = response.transaction_details?.[sessionData.txnid]
                if (txn?.status === "success") {
                    // Verify the gateway-settled amount covers the session amount.
                    // Compare in integer paise to avoid float drift.
                    const paidPaise = Math.round(parseFloat(txn.amt ?? "NaN") * 100)
                    const expPaise = Math.round(parseFloat(sessionData.amount ?? "NaN") * 100)
                    if (!Number.isFinite(paidPaise) || !Number.isFinite(expPaise) || paidPaise < expPaise) {
                        this.logger_?.warn?.(`PayU authorize: amount mismatch for ${sessionData.txnid}`)
                        return {
                            status: PaymentSessionStatus.ERROR,
                            data: { ...sessionData, status: "failed" as PayuPaymentStatus },
                        }
                    }
                    this.logger_?.info?.(`PayU authorized/captured: ${sessionData.txnid}, mode=${txn.mode}`)

                    // If autoCapture is enabled, return CAPTURED status
                    const status = this.config_.autoCapture ? PaymentSessionStatus.CAPTURED : PaymentSessionStatus.AUTHORIZED

                    return {
                        status,
                        data: {
                            ...sessionData,
                            status: this.config_.autoCapture ? ("captured" as PayuPaymentStatus) : ("authorized" as PayuPaymentStatus),
                            payuTransactionId: txn.mihpayid,
                            paymentMode: txn.mode || "Online",
                            bankRefNum: txn.bank_ref_num || "",
                            payuResponse: txn,
                        } as unknown as Record<string, unknown>,
                    }
                }
            }

            return {
                status: PaymentSessionStatus.ERROR,
                data: { ...sessionData, status: "failed" as PayuPaymentStatus },
            }
        } catch (error) {
            this.logger_?.error?.(`PayU authorizePayment error: ${error instanceof Error ? error.message : "unknown"}`)
            const sessionData = (input?.data ?? {}) as unknown as PayuSessionData
            return {
                status: PaymentSessionStatus.ERROR,
                data: { ...sessionData, status: "failed" as PayuPaymentStatus },
            }
        }
    }

    /**
     * Capture payment.
     *
     * PayU auto-captures at the gateway, but that is not sufficient reason to
     * trust our local state: this method previously flipped `status` to
     * "captured" without contacting PayU at all. Combined with a webhook-supplied
     * capture amount, that allowed an underpayment to be recorded as a
     * successful capture.
     *
     * We therefore re-verify against the PayU verify API before marking
     * captured. `input.data` here is the payment session's stored data, so
     * `txnid` and `amount` are values recorded at initiatePayment rather than
     * webhook input. Comparing the two binds the capture to the session it
     * actually belongs to.
     */
    async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
        const sessionData = input.data as unknown as PayuSessionData
        if (sessionData.status === "captured") {
            return {
                data: input.data,
            }
        }
        if (sessionData.status === "failed" || sessionData.status === "cancelled" || sessionData.status === "refunded") {
            throw new MedusaError(
                MedusaError.Types.NOT_ALLOWED,
                `Cannot capture payment in status "${sessionData.status}"`
            )
        }

        if (!sessionData.txnid) {
            throw new MedusaError(
                MedusaError.Types.NOT_ALLOWED,
                "Cannot capture payment: session is missing its PayU transaction id"
            )
        }

        // Ask the gateway what actually happened to this transaction, then decide
        // eligibility with the shared (unit-tested) helper.
        const verifyResponse = await this.client_.verifyPayment(sessionData.txnid)
        const verdict = verifyCaptureEligibility(verifyResponse, sessionData.txnid, sessionData.amount)

        if (!verdict.ok) {
            this.logger_?.warn?.(
                `[PayU capture] refused for txnid=${sessionData.txnid}: ${verdict.reason}`
            )
            throw new MedusaError(
                MedusaError.Types.NOT_ALLOWED,
                `Cannot capture payment: ${verdict.reason}`
            )
        }

        return {
            data: {
                ...sessionData,
                status: "captured" as PayuPaymentStatus,
                payuTransactionId: verdict.payuTransactionId,
                paymentMode: verdict.paymentMode,
                bankRefNum: verdict.bankRefNum,
            } as unknown as Record<string, unknown>,
        }
    }

    /**
     * Refund payment
     */
    async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
        try {
            this.logger_?.debug?.(`PayU refund initiated for txnid=${(input.data as unknown as PayuSessionData)?.txnid}`)

            const sessionData = input.data as unknown as PayuSessionData

            if (!sessionData.payuTransactionId) {
                throw new Error(
                    "No PayU transaction ID (mihpayid) found. " +
                    "This payment may not have been fully captured or the session data is incomplete."
                )
            }

            const existingRefunds = Array.isArray((sessionData as any).refunds)
                ? (sessionData as any).refunds as Array<Record<string, unknown>>
                : []
            const refundAmount = this.formatAmount(input.amount)
            const idempotencyKey = input.context?.idempotency_key
            if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
                throw new MedusaError(
                    MedusaError.Types.INVALID_DATA,
                    "A stable context.idempotency_key is required for PayU refunds"
                )
            }

            const redis = await this.getRedisClient()
            const requestPaise = Math.round(parseFloat(refundAmount) * 100)
            const capturedPaise = Math.round(parseFloat(String(sessionData.amount ?? "NaN")) * 100)
            const alreadyRefundedPaise = existingRefunds.reduce((sum, refund) => {
                const amount = Math.round(parseFloat(String(refund.amount ?? "NaN")) * 100)
                return sum + (Number.isFinite(amount) ? amount : 0)
            }, 0)
            const reservation = await reserveRefund({
                redis,
                paymentTransactionId: sessionData.payuTransactionId,
                idempotencyKey,
                amountPaise: requestPaise,
                capturedPaise,
                alreadyRefundedPaise,
            })

            if (reservation.state === "pending" && !reservation.created) {
                throw new MedusaError(
                    MedusaError.Types.UNEXPECTED_STATE,
                    "This PayU refund has an unresolved prior attempt. Reconcile it in the PayU dashboard before retrying."
                )
            }

            if (reservation.state === "succeeded") {
                const refunds = existingRefunds.some((refund) => refund.idempotency_key === idempotencyKey)
                    ? existingRefunds
                    : [...existingRefunds, {
                        amount: refundAmount,
                        request_id: reservation.requestId,
                        idempotency_key: idempotencyKey,
                        at: new Date().toISOString(),
                    }]
                const totalRefundedPaise = refunds.reduce((sum, refund) => {
                    const amount = Math.round(parseFloat(String(refund.amount ?? "NaN")) * 100)
                    return sum + (Number.isFinite(amount) ? amount : 0)
                }, 0)
                return {
                    data: {
                        ...sessionData,
                        status: totalRefundedPaise >= capturedPaise ? "refunded" as PayuPaymentStatus : sessionData.status,
                        refunds,
                    } as unknown as Record<string, unknown>,
                }
            }

            this.logger_?.debug?.(
                `PayU refund request reserved: txnid=${sessionData.txnid}, amount=${refundAmount}`
            )

            let response
            try {
                response = await this.client_.refund(
                    sessionData.payuTransactionId,
                    reservation.tokenId,
                    refundAmount
                )
            } catch (error) {
                // The request may have reached PayU before the connection failed.
                // Keep the Redis reservation and token; retries must use this same
                // idempotency key and must never create a fresh PayU token.
                throw new MedusaError(
                    MedusaError.Types.UNEXPECTED_STATE,
                    "PayU refund result is unknown. Retry with the same context.idempotency_key after reconciliation."
                )
            }

            // Log PayU response metadata only (never full PII/hash payloads)
            this.logger_?.debug?.(
                `PayU refund response: status=${response.status}, msg=${response.msg}, ` +
                `request_id=${response.request_id || 'N/A'}, ` +
                `error_code=${response.error_code || 'N/A'}`
            )

            if (response.status === 1) {
                await markRefundSucceeded({
                    redis,
                    paymentTransactionId: sessionData.payuTransactionId,
                    idempotencyKey,
                    requestId: response.request_id,
                })
                const refundRecord = {
                    amount: refundAmount,
                    request_id: response.request_id,
                    idempotency_key: idempotencyKey,
                    at: new Date().toISOString(),
                }
                const refunds = existingRefunds.some((refund) => refund.idempotency_key === idempotencyKey)
                    ? existingRefunds
                    : [...existingRefunds, refundRecord]
                const totalRefundedPaise = refunds.reduce((sum, refund) => {
                    const amount = Math.round(parseFloat(String(refund.amount ?? "NaN")) * 100)
                    return sum + (Number.isFinite(amount) ? amount : 0)
                }, 0)
                return {
                    data: {
                        ...sessionData,
                        status: totalRefundedPaise >= capturedPaise ? "refunded" as PayuPaymentStatus : sessionData.status,
                        refunds,
                        refund: {
                            amount: refundAmount,
                            request_id: response.request_id,
                        },
                    } as unknown as Record<string, unknown>,
                }
            }

            const responseMessage = String(response.msg || "").toLowerCase()
            if (responseMessage.includes("transaction not exists") || responseMessage.includes("invalid refund amount")) {
                await releaseRefund({ redis, paymentTransactionId: sessionData.payuTransactionId, idempotencyKey })
                throw new MedusaError(MedusaError.Types.INVALID_DATA, "PayU rejected the refund request")
            }

            throw new MedusaError(
                MedusaError.Types.UNEXPECTED_STATE,
                "PayU did not confirm the refund. The operation remains reserved; reconcile in the PayU dashboard before using a new idempotency key."
            )
        } catch (error) {
            this.logger_?.error?.(`PayU refundPayment error: ${error instanceof Error ? error.message : "unknown"}`)
            // Re-throw MedusaErrors as-is so message is preserved
            if (error instanceof MedusaError) {
                throw error
            }
            // Wrap unexpected errors with context
            throw new MedusaError(
                MedusaError.Types.UNEXPECTED_STATE,
                error instanceof Error ? error.message : String(error)
            )
        }
    }

    /**
     * Cancel payment
     */
    async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
        const sessionData = input.data as unknown as PayuSessionData
        if (sessionData.status === "captured" || sessionData.status === "refunded") {
            throw new MedusaError(
                MedusaError.Types.NOT_ALLOWED,
                `Cannot cancel payment in status "${sessionData.status}"; issue a refund instead`
            )
        }
        return {
            data: { ...sessionData, status: "cancelled" as PayuPaymentStatus } as unknown as Record<string, unknown>,
        }
    }

    /**
     * Delete payment session
     */
    async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
        return { data: input.data }
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
        const sessionData = input.data as unknown as PayuSessionData

        const statusMap: Record<PayuPaymentStatus, PaymentSessionStatus> = {
            pending: PaymentSessionStatus.PENDING,
            authorized: PaymentSessionStatus.AUTHORIZED,
            captured: PaymentSessionStatus.CAPTURED,
            failed: PaymentSessionStatus.ERROR,
            refunded: PaymentSessionStatus.CANCELED,
            cancelled: PaymentSessionStatus.CANCELED,
        }

        return { status: statusMap[sessionData.status] || PaymentSessionStatus.ERROR }
    }

    /**
     * Retrieve payment details
     */
    async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
        return { data: input.data }
    }

    /**
     * Update payment session
     * 
     * IMPORTANT: Always generates a fresh txnid because PayU doesn't allow
     * reusing transaction IDs - even for failed payments. This ensures
     * retry scenarios work correctly.
     */
    async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
        try {
            const { data, amount } = input
            const sessionData = data as unknown as PayuSessionData

            // ALWAYS generate a fresh txnid for PayU
            // PayU doesn't allow reusing txnids, even for failed payments
            const newTxnid = generateTxnId()

            this.logger_?.info?.(`PayU updatePayment: Generating fresh txnid ${newTxnid} (replacing ${sessionData.txnid})`)

            this.formatAmount(sessionData.amount)
            const formattedAmount = amount ? this.formatAmount(amount) : sessionData.amount

            // Build redirect URLs from environment variables
            // Allow NEXT_PUBLIC_BASE_URL as fallback for STOREFRONT_URL
            const storefrontUrl = process.env.STOREFRONT_URL || process.env.NEXT_PUBLIC_BASE_URL

            // Provide sensible defaults if specific paths aren't provided
            const redirectPath = process.env.PAYU_REDIRECT_URL || "/order/confirmed"
            const redirectFailurePath = process.env.PAYU_REDIRECT_FAILURE_URL || "/checkout"

            if (!storefrontUrl) {
                throw new Error("STOREFRONT_URL or NEXT_PUBLIC_BASE_URL environment variable is required")
            }

            let storefrontOrigin: string
            try {
                const parsed = new URL(storefrontUrl)
                if (parsed.protocol !== "https:" && this.config_.environment === "production") {
                    throw new Error("STOREFRONT_URL must use https in production")
                }
                if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
                    throw new Error("STOREFRONT_URL must be an http(s) URL")
                }
                storefrontOrigin = parsed.origin
            } catch (e) {
                if (e instanceof MedusaError) throw e
                throw new Error("STOREFRONT_URL must be a valid absolute URL")
            }

            // Constructs the URL: {origin}/{country}/{path}
            const cleanBase = storefrontOrigin.replace(/\/$/, "")
            const cleanPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`
            const cleanFailPath = redirectFailurePath.startsWith("/") ? redirectFailurePath : `/${redirectFailurePath}`

            // Generate new hash with the fresh txnid
            const hash = this.client_.generatePaymentHash({
                txnid: newTxnid,
                amount: formattedAmount,
                productinfo: sessionData.productinfo,
                firstname: sessionData.firstname,
                email: sessionData.email,
                udf1: sessionData.udf1,
                udf2: sessionData.udf2,
                udf3: sessionData.udf3,
                udf4: formattedAmount,
            })

            const surl = `${cleanBase}/${sessionData.countryCode || 'in'}${cleanPath}`
            const furl = `${cleanBase}/${sessionData.countryCode || 'in'}${cleanFailPath}`

            return {
                // UpdatePaymentOutput extends PaymentProviderOutput, which carries
                // only `data` (and optionally `status`). Returning an `id` here was a
                // type error; the fresh txnid is already recorded inside `data`.
                data: {
                    ...sessionData,
                    txnid: newTxnid,  // Replace with fresh txnid
                    amount: formattedAmount,
                    hash,
                    form_data: {
                        key: this.config_.merchantKey,
                        txnid: newTxnid,  // Use fresh txnid
                        amount: formattedAmount,
                        productinfo: sessionData.productinfo,
                        firstname: sessionData.firstname,
                        email: sessionData.email,
                        phone: sessionData.phone,
                        surl,
                        furl,
                        hash,
                        udf1: sessionData.udf1,
                        udf2: sessionData.udf2,
                        udf3: sessionData.udf3,
                        udf4: formattedAmount,
                        service_provider: "payu_paisa",
                    },
                } as unknown as Record<string, unknown>,
            }
        } catch (error) {
            this.logger_?.error?.(`PayU updatePayment error: ${error instanceof Error ? error.message : "unknown"}`)
            throw error
        }
    }

    /**
     * Handle webhook from PayU
     * 
     * PayU sends webhooks for payment status updates.
     * Webhook URL format: https://your-backend.com/hooks/payment/payu_payu
     * 
     * The webhook payload is URL-encoded form data with fields matching PayuWebhookPayload.
     * Hash verification ensures the webhook is authentic and hasn't been tampered with.
     */
    async getWebhookActionAndData(data: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
        try {
            this.logger_?.debug?.(`[PayU Webhook] payload received`)

            // INTERCEPT EXPRESS/MEDUSA MIS-PARSED JSON STRINGS
            // recover express body parser oopsies 
            const extractJson = (payload: any) => {
                if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
                    const keys = Object.keys(payload);
                    if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].trim().startsWith('{') && keys[0].trim().endsWith('}')) {
                        try {
                            return JSON.parse(keys[0]);
                        } catch (e) { /* ignore */ }
                    }
                }
                return payload;
            };

            let resolvedData = extractJson(data);
            if (resolvedData?.data) {
                resolvedData.data = extractJson(resolvedData.data);
            }
            if ((resolvedData as Record<string, unknown>)?.rawData && !Buffer.isBuffer((resolvedData as any).rawData) && typeof (resolvedData as any).rawData === 'object') {
                (resolvedData as any).rawData = extractJson((resolvedData as any).rawData);
            }

            // unwrap PayU new payload structure
            if (resolvedData?.event_payload && typeof resolvedData.event_payload === 'object') {
                resolvedData = resolvedData.event_payload;
            } else if (resolvedData?.data?.event_payload && typeof resolvedData.data.event_payload === 'object') {
                resolvedData.data = resolvedData.data.event_payload;
            } else if ((resolvedData as any)?.rawData?.event_payload && typeof (resolvedData as any).rawData.event_payload === 'object') {
                (resolvedData as any).rawData = (resolvedData as any).rawData.event_payload;
            }

            // PayU webhooks can send JSON or form-urlencoded data
            // Medusa provides both parsed `data` and `rawData` (Buffer/string)
            // Priority: parsed data.data > rawData > direct properties
            let webhook: PayuWebhookPayload

            // 1. Check if data.data contains the webhook fields (Medusa already parsed the body)
            if (resolvedData?.data && typeof resolvedData.data === 'object' && !Buffer.isBuffer(resolvedData.data)) {
                const dataObj = resolvedData.data as Record<string, unknown>
                // map alternative key names if missing
                if (dataObj.merchantTransactionId && !dataObj.txnid) dataObj.txnid = dataObj.merchantTransactionId
                if (dataObj.paymentId && !dataObj.mihpayid) dataObj.mihpayid = dataObj.paymentId
                if (dataObj.customerEmail && !dataObj.email) dataObj.email = dataObj.customerEmail
                if (dataObj.customerName && !dataObj.firstname) dataObj.firstname = dataObj.customerName
                if (dataObj.customerPhone && !dataObj.phone) dataObj.phone = dataObj.customerPhone
                if (dataObj.productInfo && !dataObj.productinfo) dataObj.productinfo = dataObj.productInfo

                if (dataObj.txnid || dataObj.status) {
                    webhook = dataObj as unknown as PayuWebhookPayload
                    this.logger_?.debug?.(`PayU webhook: Extracted from data.data, txnid=${webhook.txnid}`)
                } else {
                    this.logger_?.warn?.(`[PayU Webhook] data.data missing txnid/status: keys=${Object.keys(dataObj).join(',')}`)
                    webhook = dataObj as unknown as PayuWebhookPayload
                }
            }
            // 2. Fallback to rawData (Buffer/string) — try JSON first, then URL-encoded
            else if ((resolvedData as Record<string, unknown>)?.rawData) {
                const rawData = (resolvedData as Record<string, unknown>).rawData
                this.logger_?.debug?.(`PayU webhook: Using rawData fallback, type=${typeof rawData}`)

                if (typeof rawData === 'string' || Buffer.isBuffer(rawData)) {
                    const bodyStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : rawData
                    const trimmed = bodyStr.trim()

                    // Try JSON first (PayU's newer webhook format)
                    if (trimmed.startsWith('{')) {
                        try {
                            let parsed = JSON.parse(trimmed)
                            // Unwrap event_payload if present
                            if (parsed.event_payload && typeof parsed.event_payload === 'object') {
                                parsed = parsed.event_payload
                            }
                            webhook = parsed as PayuWebhookPayload
                            this.logger_?.debug?.(`PayU webhook: Parsed rawData as JSON, txnid=${webhook.txnid}`)
                        } catch (e) {
                            // JSON parse failed, fall through to URL-encoded
                            const params = new URLSearchParams(bodyStr)
                            webhook = Object.fromEntries(params.entries()) as unknown as PayuWebhookPayload
                            this.logger_?.debug?.(`PayU webhook: Parsed rawData as URL-encoded, txnid=${webhook.txnid}`)
                        }
                    } else {
                        // URL-encoded form data (PayU's legacy format)
                        const params = new URLSearchParams(bodyStr)
                        webhook = Object.fromEntries(params.entries()) as unknown as PayuWebhookPayload
                        this.logger_?.debug?.(`PayU webhook: Parsed rawData as URL-encoded, txnid=${webhook.txnid}`)
                    }
                } else {
                    webhook = rawData as unknown as PayuWebhookPayload
                }
            }
            // 3. Check direct properties on resolvedData
            else if ((resolvedData as Record<string, unknown>)?.txnid || (resolvedData as Record<string, unknown>)?.status || (resolvedData as Record<string, unknown>)?.merchantTransactionId) {
                const dataObj = resolvedData as Record<string, unknown>
                if (dataObj.merchantTransactionId && !dataObj.txnid) dataObj.txnid = dataObj.merchantTransactionId
                if (dataObj.paymentId && !dataObj.mihpayid) dataObj.mihpayid = dataObj.paymentId
                if (dataObj.customerEmail && !dataObj.email) dataObj.email = dataObj.customerEmail
                if (dataObj.customerName && !dataObj.firstname) dataObj.firstname = dataObj.customerName
                if (dataObj.customerPhone && !dataObj.phone) dataObj.phone = dataObj.customerPhone
                if (dataObj.productInfo && !dataObj.productinfo) dataObj.productinfo = dataObj.productInfo

                webhook = dataObj as unknown as PayuWebhookPayload
            } else {
                this.logger_?.error?.(`[PayU Webhook] unreadable payload: keys=${resolvedData && typeof resolvedData === "object" ? Object.keys(resolvedData).join(",") : typeof resolvedData}`)
                return { action: "not_supported" }
            }

            if (
                typeof webhook.txnid !== "string" || !webhook.txnid ||
                typeof webhook.status !== "string" || !webhook.status ||
                typeof webhook.hash !== "string" || !webhook.hash ||
                (webhook.amount !== undefined && typeof webhook.amount !== "string" && typeof webhook.amount !== "number")
            ) {
                this.logger_?.error?.("[PayU Webhook] missing or mistyped required fields")
                return { action: "not_supported" }
            }

            if (!webhook.amount) {
                this.logger_?.warn?.(`[PayU Webhook] missing amount for txnid=${webhook.txnid}`)
                return { action: "not_supported" }
            }

            // Defense-in-depth: hash already binds key, but reject obvious key mismatches early.
            if (webhook.key && webhook.key !== this.config_.merchantKey) {
                this.logger_?.warn?.(`[PayU Webhook] merchant key mismatch for txnid=${webhook.txnid}`)
                return { action: "not_supported" }
            }

            this.logger_?.info?.(
                `[PayU Webhook] txnid=${webhook.txnid}, status=${webhook.status}, amount=${webhook.amount}`
            )

            // Verify hash BEFORE claiming the replay slot: otherwise anyone can
            // squat the dedupe key with a bogus body and block the real webhook.
            // Formula: sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
            const isValid = this.client_.verifyResponseHash({
                status: webhook.status,
                email: webhook.email,
                firstname: webhook.firstname,
                productinfo: webhook.productinfo,
                amount: webhook.amount,
                txnid: webhook.txnid,
                hash: webhook.hash,
                udf1: webhook.udf1,
                udf2: webhook.udf2,
                udf3: webhook.udf3,
                udf4: webhook.udf4,
                udf5: webhook.udf5,
                additionalCharges: (webhook as PayuWebhookPayload).additionalCharges,
            })

            if (!isValid) {
                this.logger_?.warn?.(
                    `PayU webhook: Hash verification FAILED for txnid=${webhook.txnid}. ` +
                    `This could indicate a tampered webhook or configuration mismatch.`
                )
                return { action: "not_supported" }
            }

            this.logger_?.debug?.(`PayU webhook: Hash verified successfully for txnid=${webhook.txnid}`)

            const normalizedForDedupe = webhook.status.toLowerCase()
            const replayKey = `${webhook.txnid}:${normalizedForDedupe}:${webhook.mihpayid || "na"}:${webhook.amount}:${webhook.hash.slice(0, 16)}`
            if (!(await this.markWebhookProcessed(replayKey))) {
                this.logger_?.warn?.(`[PayU Webhook] replay detected for txnid=${webhook.txnid}`)
                return { action: "not_supported" }
            }

            // Session ID is the Medusa payment session ID, stored in udf3 during initiatePayment
            // This is required for Medusa's processPaymentWorkflow to find the payment session.
            // Fail closed when missing: falling back to txnid would wedge the payment.
            const sessionId = (webhook.udf3 || "").trim()
            if (!sessionId) {
                this.logger_?.error?.(`[PayU Webhook] missing udf3 session_id for txnid=${webhook.txnid}`)
                return { action: "not_supported" }
            }
            const status = webhook.status.toLowerCase()

            // Map statuses for faster switch-case matching
            const statusMap: Record<string, string> = {
                "success": "success",
                "successful": "success",
                "failure": "failed",
                "failed": "failed",
                "cancelled": "failed",
                "cancel": "failed",
                "usercancelled": "failed",
                "user_cancelled": "failed",
                "bounced": "failed",
                "pending": "pending",
                "refund": "refund",
                "refunded": "refund",
                "dispute": "dispute",
                "chargeback": "dispute",
            }
            const normalizedStatus = statusMap[status] || status

            switch (normalizedStatus) {
                case "success":
                    this.logger_?.info?.(`PayU webhook: Payment SUCCESS for txnid=${webhook.txnid}, processing session ${sessionId}`)

                    // Self-consistency check: compare paid amount with expected amount (stored in udf4).
                    // NOTE: udf4 echoes our own initiate request, so this is NOT a
                    // server-side authorization check — it only catches stale/partial
                    // form submissions. Authoritative verification happens in
                    // authorizePayment via the PayU verify API. Require udf4.
                    const paidPaise = Math.round(parseFloat(webhook.amount) * 100)
                    const expectedPaise = Math.round(parseFloat(webhook.udf4 || "NaN") * 100)

                    if (!Number.isFinite(paidPaise)) {
                        this.logger_?.warn?.(`[PayU Webhook] invalid paid amount for txnid=${webhook.txnid}`)
                        return { action: "not_supported" }
                    }
                    if (!Number.isFinite(expectedPaise)) {
                        this.logger_?.warn?.(
                            `[PayU Webhook] missing expected amount (udf4) for txnid=${webhook.txnid}. Marking as requires_more.`
                        )
                        return {
                            action: "requires_more",
                            data: {
                                session_id: sessionId,
                                amount: new BigNumber(webhook.amount),
                            },
                        }
                    }
                    if (paidPaise < expectedPaise) {
                        this.logger_?.warn?.(
                            `[PayU Webhook] Amount discrepancy detected for txnid=${webhook.txnid}. ` +
                            `Expected: ${webhook.udf4}, Paid: ${webhook.amount}. Marking as requires_more.`
                        )
                        return {
                            action: "requires_more",
                            data: {
                                session_id: sessionId,
                                amount: new BigNumber(webhook.amount),
                            },
                        }
                    }

                    // `amount` is REQUIRED by WebhookActionData, so it cannot simply be omitted.
                    //
                    // Both `amount` and `udf4` are covered by the response hash that
                    // was verified above, so neither can be tampered with. We report
                    // udf4 — the amount this transaction was initiated for — rather
                    // than echoing the request body.
                    //
                    // This value is ADVISORY ONLY. Medusa forwards it into
                    // capturePaymentWorkflow, but capturePayment() ignores it and
                    // re-derives the truth from the payment session's own stored
                    // amount plus a fresh PayU verify_payment call. That check is the
                    // actual authorisation boundary: pointing this callback at another
                    // customer's session does not help, because the txnid verified is
                    // the one recorded on that session at initiatePayment.
                    return {
                        action: this.config_.autoCapture ? "captured" : "authorized",
                        data: {
                            session_id: sessionId,
                            amount: new BigNumber(webhook.udf4 || webhook.amount),
                        },
                    }
                case "failed":
                    this.logger_?.info?.(
                        `PayU webhook: Payment FAILED for txnid=${webhook.txnid}, ` +
                        `error=${webhook.error || 'N/A'}, error_Message=${webhook.error_Message || 'N/A'}`
                    )
                    return {
                        action: "failed",
                        data: {
                            session_id: sessionId,
                            amount: new BigNumber(webhook.amount),
                        },
                    }
                case "pending":
                    this.logger_?.info?.(`PayU webhook: Payment PENDING for txnid=${webhook.txnid}`)
                    return { action: "not_supported" }
                case "refund":
                    this.logger_?.info?.(
                        `PayU webhook: REFUND processed for txnid=${webhook.txnid}, ` +
                        `mihpayid=${webhook.mihpayid || 'N/A'}, amount=${webhook.amount}`
                    )
                    return { action: "not_supported" }
                case "dispute":
                    this.logger_?.warn?.(
                        `PayU webhook: DISPUTE/CHARGEBACK received for txnid=${webhook.txnid}, ` +
                        `mihpayid=${webhook.mihpayid || 'N/A'}, amount=${webhook.amount}. ` +
                        `Manual review required!`
                    )
                    return { action: "not_supported" }
                default:
                    this.logger_?.info?.(`PayU webhook: Unhandled status '${webhook.status}' for txnid=${webhook.txnid}`)
                    return { action: "not_supported" }
            }
        } catch (error) {
            this.logger_?.error?.(
                `PayU webhook processing error: ${error instanceof Error ? error.message : "unknown"}`
            )
            if (this.config_.environment === "production") {
                throw error
            }
            return { action: "not_supported" }
        }
    }
}

export default PayuPaymentProviderService
