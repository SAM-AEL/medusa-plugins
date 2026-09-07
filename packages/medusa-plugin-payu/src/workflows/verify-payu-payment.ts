/**
 * Verify PayU Payment Workflow
 * 
 * Workflow to verify payment status with PayU API
 */

import {
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PayuClient } from "../providers/payu/client"
import type { PayuProviderConfig } from "../providers/payu/types"

/**
 * Input for verify payment workflow (no secrets: read from env/provider config)
 */
export interface VerifyPayuPaymentInput {
    txnid: string
    environment?: "test" | "production"
}

/**
 * Output of verify payment workflow
 */
export interface VerifyPayuPaymentOutput {
    success: boolean
    status: string
    transaction?: Record<string, unknown>
    error?: string
}

/**
 * Step: Verify payment with PayU API
 */
const verifyPaymentStep = createStep(
    "verify-payu-payment-step",
    async (input: VerifyPayuPaymentInput): Promise<StepResponse<VerifyPayuPaymentOutput>> => {
        const {
            txnid,
            environment = (process.env.PAYU_ENVIRONMENT as "test" | "production") || "test",
        } = input
        const merchantKey = process.env.PAYU_MERCHANT_KEY || ""
        const merchantSalt = process.env.PAYU_MERCHANT_SALT || ""

        if (!txnid || !/^[A-Za-z0-9_-]{1,25}$/.test(txnid)) {
            return new StepResponse({
                success: false,
                status: "error",
                error: "Invalid txnid",
            })
        }

        if (!merchantKey || !merchantSalt) {
            return new StepResponse({
                success: false,
                status: "error",
                error: "PayU configuration missing",
            })
        }

        try {
            const config: PayuProviderConfig = { merchantKey, merchantSalt, environment }
            const client = new PayuClient(config)
            const response = await client.verifyPayment(txnid)

            if (response.status === 1) {
                const txn = response.transaction_details?.[txnid]
                if (txn) {
                    return new StepResponse({
                        success: txn.status === "success",
                        status: txn.status,
                        transaction: txn as unknown as Record<string, unknown>,
                    })
                }
            }

            return new StepResponse({
                success: false,
                status: "not_found",
                error: response.msg || "Transaction not found",
            })
        } catch (error) {
            return new StepResponse({
                success: false,
                status: "error",
                error: (error as Error).message,
            })
        }
    }
)

/**
 * Verify PayU Payment Workflow
 */
export const verifyPayuPaymentWorkflow = createWorkflow(
    "verify-payu-payment",
    (input: VerifyPayuPaymentInput) => {
        const result = verifyPaymentStep(input)
        return new WorkflowResponse(result)
    }
)

export default verifyPayuPaymentWorkflow
