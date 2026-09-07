import type { MedusaResponse } from "@medusajs/framework/http"

export const MAX_LIMIT = 100
export const MAX_TEMPLATE_VARIABLES = 10

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

export function normalizeTemplateVariables(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }

  const out: Record<string, string> = Object.create(null)
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, MAX_TEMPLATE_VARIABLES)) {
    const normalizedKey = String(key).trim()
    if (!/^[A-Za-z0-9_]+$/.test(normalizedKey)) {
      continue
    }
    out[normalizedKey] = String(value ?? "").slice(0, 2000)
  }
  return out
}

export function normalizePhoneToE164(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  if (!/^\+?[0-9\s\-().]+$/.test(trimmed)) {
    return null
  }
  const digits = trimmed.replace(/\D/g, "")
  // E.164: country code + subscriber number, 8..15 digits total
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    return null
  }
  return digits
}

export function isLikelyPhone(value: unknown): value is string {
  return normalizePhoneToE164(value) !== null
}

export function setDeprecatedPutHeaders(res: MedusaResponse, replacementMethod: "POST", replacementPath: string) {
  res.setHeader("Deprecation", "true")
  res.setHeader("Sunset", "Thu, 31 Dec 2026 23:59:59 GMT")
  res.setHeader("X-Deprecated-Method", "PUT")
  res.setHeader("X-Replacement-Method", replacementMethod)
  res.setHeader("X-Replacement-Path", replacementPath)
}
