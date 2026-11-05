/**
 * PayU SDK Client
 * Manual hash implementation based on PayU documentation
 * https://docs.payu.in/docs/generate-hash-merchant-hosted
 */

import crypto from "crypto"
import type { Logger } from "@medusajs/framework/types"
import type { PayuProviderConfig, PayuVerifyResponse, PayuRefundResponse } from "./types"
import { PAYU_DEFAULT_TIMEOUT_MS } from "./config"

// PayU API Endpoints
const PAYU_ENDPOINTS = {
    production: {
        payment: "https://secure.payu.in/_payment",
        api: "https://info.payu.in/merchant/postservice.php?form=2"
    },
    test: {
        payment: "https://test.payu.in/_payment",
        api: "https://test.payu.in/merchant/postservice.php?form=2"
    }
}

/**
 * PayU Client for payment operations
 */
export class PayuClient {
    private config: PayuProviderConfig
    private logger?: Logger

    constructor(config: PayuProviderConfig, logger?: Logger) {
        this.config = config
        this.logger = logger
    }

    /**
     * Default API timeout in milliseconds (30 seconds)
     */
    private readonly API_TIMEOUT_MS = PAYU_DEFAULT_TIMEOUT_MS

    /**
     * Fetch with timeout to prevent hanging requests
     */
    private async fetchWithTimeout(
        url: string,
        options: RequestInit,
        timeoutMs: number = this.API_TIMEOUT_MS
    ): Promise<Response> {
        const safeTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? Math.min(Math.floor(timeoutMs), 60000)
            : PAYU_DEFAULT_TIMEOUT_MS
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), safeTimeout)

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            })
            return response
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`PayU API request timed out after ${safeTimeout}ms`)
            }
            throw error
        } finally {
            clearTimeout(timeoutId)
        }
    }

    /**
     * Get PayU payment URL
     */
    getPaymentUrl(): string {
        return PAYU_ENDPOINTS[this.config.environment].payment
    }

    /**
     * Generate payment hash
     * 
     * Formula from PayU docs:
     * sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
     * 
     * Note: "||||||" is a literal string (6 pipes) appended after udf5
     */
    generatePaymentHash(params: {
        txnid: string
        amount: string
        productinfo: string
        firstname: string
        email: string
        udf1?: string
        udf2?: string
        udf3?: string
        udf4?: string
        udf5?: string
    }): string {
        const key = this.config.merchantKey
        const salt = this.config.merchantSalt
        const udf1 = params.udf1 || ""
        const udf2 = params.udf2 || ""
        const udf3 = params.udf3 || ""
        const udf4 = params.udf4 || ""
        const udf5 = params.udf5 || ""

        // Exact formula from PayU docs:
        // sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
        // The ||||||SALT means 5 empty reserved fields between udf5 and SALT (creating 6 pipes)
        const hashString = `${key}|${params.txnid}|${params.amount}|${params.productinfo}|${params.firstname}|${params.email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`

        const generatedHash = crypto.createHash("sha512").update(hashString).digest("hex").toLowerCase()

        this.logger?.debug?.(`PayU hash generated for txnid: ${params.txnid}`)

        return generatedHash
    }

    /**
     * Calculate expected response hash from PayU callback/webhook
     */
    calculateResponseHash(params: {
        status: string
        email: string
        firstname: string
        productinfo: string
        amount: string
        txnid: string
        udf1?: string
        udf2?: string
        udf3?: string
        udf4?: string
        udf5?: string
        additionalCharges?: string
    }): string {
        const salt = this.config.merchantSalt
        const key = this.config.merchantKey
        const status = params.status ?? ""
        const email = params.email ?? ""
        const firstname = params.firstname ?? ""
        const productinfo = params.productinfo ?? ""
        const amount = params.amount ?? ""
        const txnid = params.txnid ?? ""
        const udf1 = params.udf1 || ""
        const udf2 = params.udf2 || ""
        const udf3 = params.udf3 || ""
        const udf4 = params.udf4 || ""
        const udf5 = params.udf5 || ""

        let hashString: string
        if (params.additionalCharges) {
            hashString = `${params.additionalCharges}|${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`
        } else {
            hashString = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`
        }

        return crypto.createHash("sha512").update(hashString).digest("hex").toLowerCase()
    }

    /**
     * Verify response hash from PayU callback/webhook
     * 
     * Reverse hash formula:
     * sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
     */
    verifyResponseHash(params: {
        status: string
        email: string
        firstname: string
        productinfo: string
        amount: string
        txnid: string
        hash: string
        udf1?: string
        udf2?: string
        udf3?: string
        udf4?: string
        udf5?: string
        additionalCharges?: string
    }): boolean {
        const status = params.status ?? ""
        const txnid = params.txnid ?? ""
        const hash = params.hash ?? ""
        if (!status || !txnid || !hash) {
            return false
        }

        const calculatedHash = this.calculateResponseHash(params)
        const incomingHash = hash.toLowerCase()
        const calculatedBuffer = Buffer.from(calculatedHash, "utf8")
        const incomingBuffer = Buffer.from(incomingHash, "utf8")
        if (calculatedBuffer.length !== incomingBuffer.length) {
            return false
        }
        return crypto.timingSafeEqual(calculatedBuffer, incomingBuffer)
    }

    /**
     * Verify payment status with PayU API
     */
    async verifyPayment(txnid: string): Promise<PayuVerifyResponse> {
        const command = "verify_payment"
        const hashString = `${this.config.merchantKey}|${command}|${txnid}|${this.config.merchantSalt}`
        const hash = crypto.createHash("sha512").update(hashString).digest("hex")

        const apiUrl = PAYU_ENDPOINTS[this.config.environment].api

        const response = await this.fetchWithTimeout(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                key: this.config.merchantKey,
                command: command,
                var1: txnid,
                hash: hash,
            }),
        })

        if (!response.ok) {
            throw new Error(`PayU API error ${response.status} on ${command}`)
        }
        const text = await response.text()
        try {
            return JSON.parse(text) as PayuVerifyResponse
        } catch {
            throw new Error(`PayU non-JSON response on ${command}`)
        }
    }

    /**
     * Initiate refund
     */
    async refund(
        mihpayid: string,
        tokenId: string,
        amount: string
    ): Promise<PayuRefundResponse> {
        const command = "cancel_refund_transaction"
        const hashString = `${this.config.merchantKey}|${command}|${mihpayid}|${this.config.merchantSalt}`
        const hash = crypto.createHash("sha512").update(hashString).digest("hex")

        const apiUrl = PAYU_ENDPOINTS[this.config.environment].api

        const response = await this.fetchWithTimeout(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                key: this.config.merchantKey,
                command: command,
                var1: mihpayid,
                var2: tokenId,
                var3: amount,
                hash: hash,
            }),
        })

        if (!response.ok) {
            throw new Error(`PayU API error ${response.status} on ${command}`)
        }
        const text = await response.text()
        try {
            return JSON.parse(text) as PayuRefundResponse
        } catch {
            throw new Error(`PayU non-JSON response on ${command}`)
        }
    }
}

/**
 * Generate unique transaction ID (max 25 chars per PayU docs)
 */
export function generateTxnId(): string {
    return `T${Date.now().toString(36)}${crypto.randomBytes(8).toString("hex")}`.slice(0, 25)
}
