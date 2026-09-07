import type { MedusaResponse } from "@medusajs/framework/http"

export const MAX_LIMIT = 100

export function ok(res: MedusaResponse, data: Record<string, unknown>, status = 200) {
  return res.status(status).json({ success: true, ...data })
}

export function fail(
  res: MedusaResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return res.status(status).json({
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
  })
}

export function parsePagination(query: Record<string, unknown>, defaultLimit = 50) {
  const rawLimit = Number(query.limit ?? defaultLimit)
  const rawOffset = Number(query.offset ?? 0)
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(rawLimit))) : defaultLimit
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0
  return { limit, offset }
}
