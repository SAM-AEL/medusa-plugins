import crypto from "crypto"

export type RefundReservation = {
    tokenId: string
    state: "pending" | "succeeded"
    requestId?: string
    amountPaise: number
    created: boolean
}

const reserveRefundScript = `
local existing = redis.call("GET", KEYS[1])
if existing then
  local record = cjson.decode(existing)
  if record.payment_id ~= ARGV[1] or record.amount_paise ~= ARGV[2] then
    return {"conflict"}
  end
  return {record.token_id, record.state, record.request_id or "", "0", record.amount_paise}
end
local stored_total = redis.call("GET", KEYS[2])
local total = tonumber(stored_total or ARGV[4])
local amount = tonumber(ARGV[2])
local captured = tonumber(ARGV[3])
if total + amount > captured then
  return {"exceeds_balance"}
end
local record = cjson.encode({payment_id=ARGV[1], amount_paise=ARGV[2], token_id=ARGV[5], state="pending"})
redis.call("SET", KEYS[1], record)
redis.call("SET", KEYS[2], tostring(total + amount))
return {ARGV[5], "pending", "", "1", ARGV[2]}
`

const completeRefundScript = `
local existing = redis.call("GET", KEYS[1])
if not existing then return 0 end
local record = cjson.decode(existing)
record.state = "succeeded"
record.request_id = ARGV[1]
redis.call("SET", KEYS[1], cjson.encode(record))
return 1
`

const releaseRefundScript = `
local existing = redis.call("GET", KEYS[1])
if not existing then return 0 end
local record = cjson.decode(existing)
if record.state ~= "pending" then return 0 end
redis.call("DEL", KEYS[1])
local total = tonumber(redis.call("GET", KEYS[2]) or "0")
redis.call("SET", KEYS[2], tostring(math.max(0, total - tonumber(record.amount_paise))))
return 1
`

export function refundOperationIdempotencyKey(input: {
    paymentTransactionId: string
    idempotencyKey: string
}): string {
    return crypto.createHash("sha256")
        .update(`${input.paymentTransactionId}|${input.idempotencyKey}`)
        .digest("hex")
}

export async function reserveRefund(input: {
    redis: { eval: (...args: any[]) => Promise<any> }
    paymentTransactionId: string
    idempotencyKey: string
    amountPaise: number
    capturedPaise: number
    alreadyRefundedPaise?: number
}): Promise<RefundReservation> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.idempotencyKey)) {
        throw new Error("A valid context.idempotency_key is required for refunds")
    }
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 ||
        !Number.isSafeInteger(input.capturedPaise) || input.capturedPaise <= 0) {
        throw new Error("Refund amounts must be positive whole paise values")
    }

    const operationId = refundOperationIdempotencyKey(input)
    const tokenCandidate = `REF_${crypto.randomBytes(8).toString("hex")}`
    const result = await input.redis.eval(
        reserveRefundScript,
        2,
        `payu_refund:operation:${operationId}`,
        `payu_refund:reserved:${input.paymentTransactionId}`,
        input.paymentTransactionId,
        String(input.amountPaise),
        String(input.capturedPaise),
        String(input.alreadyRefundedPaise ?? 0),
        tokenCandidate,
    ) as string[]

    if (result[0] === "conflict") {
        throw new Error("The idempotency key was already used for a different refund")
    }
    if (result[0] === "exceeds_balance") {
        throw new Error("Refund amount exceeds the remaining capturable balance")
    }
    if (!result[0] || !["pending", "succeeded"].includes(result[1])) {
        throw new Error("Could not reserve PayU refund operation")
    }

    return {
        tokenId: result[0],
        state: result[1] as RefundReservation["state"],
        requestId: result[2] || undefined,
        amountPaise: Number(result[4]),
        created: result[3] === "1",
    }
}

export async function markRefundSucceeded(input: {
    redis: { eval: (...args: any[]) => Promise<any> }
    paymentTransactionId: string
    idempotencyKey: string
    requestId?: string
}): Promise<void> {
    const operationId = refundOperationIdempotencyKey(input)
    const updated = await input.redis.eval(
        completeRefundScript,
        1,
        `payu_refund:operation:${operationId}`,
        input.requestId || "",
    )
    if (Number(updated) !== 1) throw new Error("PayU refund reservation disappeared before completion")
}

export async function releaseRefund(input: {
    redis: { eval: (...args: any[]) => Promise<any> }
    paymentTransactionId: string
    idempotencyKey: string
}): Promise<void> {
    const operationId = refundOperationIdempotencyKey(input)
    await input.redis.eval(
        releaseRefundScript,
        2,
        `payu_refund:operation:${operationId}`,
        `payu_refund:reserved:${input.paymentTransactionId}`,
    )
}

