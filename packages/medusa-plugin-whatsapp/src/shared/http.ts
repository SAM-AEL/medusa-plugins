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

/**
 * Valid E.164 country calling codes (1-3 digits). Used by maskPhone() to work
 * out how much of the leading digits are the country/area prefix so that only
 * that prefix and the final 4 digits survive masking.
 */
const COUNTRY_CALLING_CODES = new Set([
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45",
  "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63",
  "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98",
  "211", "212", "213", "216", "218", "220", "233", "234", "251", "254", "255", "256",
  "260", "263", "297", "298", "299", "350", "351", "352", "353", "354", "355", "356",
  "357", "358", "359", "370", "371", "372", "380", "381", "385", "386", "387", "389",
  "420", "421", "423", "500", "501", "502", "503", "504", "505", "506", "507", "508",
  "509", "590", "591", "592", "593", "595", "597", "598", "599", "670", "672", "673",
  "674", "675", "676", "677", "678", "679", "680", "681", "682", "683", "685", "686",
  "687", "688", "689", "690", "691", "692", "850", "852", "853", "855", "856", "880",
  "886", "960", "961", "962", "963", "964", "965", "966", "967", "968", "970", "971",
  "972", "973", "974", "975", "976", "977", "992", "993", "994", "995", "996", "998",
])

/**
 * Mask a phone number for display/logging, preserving the country calling code
 * and the final 4 digits. Matches the format documented in the README, e.g.
 * "+91 98765 43210" -> "+91 ****** 3210".
 *
 * The subscriber digits are always replaced, so the raw number is never
 * returned. Safe to use on API responses.
 */
export function maskPhone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return ""
  }
  const digits = value.replace(/\D/g, "")
  if (!digits) {
    return ""
  }

  // Determine the longest valid country calling code (1-3 digits) as the prefix.
  let prefixLen = 0
  for (const len of [3, 2, 1]) {
    if (digits.length > len && COUNTRY_CALLING_CODES.has(digits.slice(0, len))) {
      prefixLen = len
      break
    }
  }

  const hasPlus = value.trim().startsWith("+")
  // Only emit a "+" prefix when an actual country code was identified,
  // otherwise "+" alone would be meaningless.
  const prefix = hasPlus && prefixLen > 0 ? `+${digits.slice(0, prefixLen)}` : hasPlus ? "" : digits.slice(0, prefixLen)
  const separator = prefix ? " " : ""
  const subscriber = digits.slice(prefixLen)

  // Too short to mask meaningfully — fully star it rather than reveal digits.
  if (subscriber.length <= 4) {
    return `${prefix}${separator}${"*".repeat(Math.max(subscriber.length, 1))}`
  }

  return `${prefix}${separator}${"*".repeat(6)} ${subscriber.slice(-4)}`
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
