import type { MedusaResponse } from "@medusajs/framework/http"

/**
 * Minimal in-process sliding-window rate limiter.
 *
 * Used to bound the admin-triggered send endpoints so a compromised or
 * over-used admin credential cannot turn the configured SMTP/WhatsApp account
 * into an open relay.
 *
 * NOTE: state is per-process. Behind multiple instances each keeps its own
 * counters, so the effective ceiling scales with instance count. That is still
 * far better than no cap; a shared store would be needed for a strict global
 * limit.
 */
interface RateLimitEntry {
    count: number
    windowStart: number
}

export class RateLimiter {
    private requests = new Map<string, RateLimitEntry>()
    private readonly maxCacheSize = 10000
    private readonly maxRequests: number
    private readonly windowMs: number

    constructor(maxRequests: number, windowMs: number) {
        this.maxRequests = maxRequests
        this.windowMs = windowMs
        const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000)
        if (typeof (timer as any).unref === "function") {
            ;(timer as any).unref()
        }
    }

    isAllowed(identifier: string): boolean {
        if (this.requests.size >= this.maxCacheSize) {
            this.cleanup()
        }
        const now = Date.now()
        const entry = this.requests.get(identifier)

        if (!entry || now - entry.windowStart >= this.windowMs) {
            this.requests.set(identifier, { count: 1, windowStart: now })
            return true
        }

        if (entry.count >= this.maxRequests) {
            return false
        }

        entry.count += 1
        return true
    }

    private cleanup(): void {
        const now = Date.now()
        for (const [key, entry] of this.requests.entries()) {
            if (now - entry.windowStart >= this.windowMs) {
                this.requests.delete(key)
            }
        }
    }
}

/**
 * Identify the caller for rate-limiting purposes.
 *
 * Admin routes are authenticated, so the authenticated actor id is the most
 * reliable key; it cannot be spoofed by request headers the way an IP can.
 */
export function getActorId(req: any): string {
    const actorId = req?.auth_context?.actor_id
    if (actorId) {
        return String(actorId)
    }
    const direct = req?.ip || req?.socket?.remoteAddress
    return direct ? String(direct) : "unknown"
}

export const MAX_LIMIT = 100
export const MAX_TEMPLATE_VARIABLES = 20

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

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") {
    return false
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function normalizeTemplateVariables(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }

  const entries = Object.entries(input as Record<string, unknown>).slice(0, MAX_TEMPLATE_VARIABLES)
  const out: Record<string, string> = Object.create(null)

  for (const [key, value] of entries) {
    const normalizedKey = String(key).trim()
    if (!/^[A-Za-z0-9_]+$/.test(normalizedKey)) {
      continue
    }
    out[normalizedKey] = String(value ?? "").slice(0, 2000)
  }

  return out
}

export function setDeprecatedPutHeaders(res: MedusaResponse, replacementMethod: "POST", replacementPath: string) {
  res.setHeader("Deprecation", "true")
  res.setHeader("Sunset", "Thu, 31 Dec 2026 23:59:59 GMT")
  res.setHeader("X-Deprecated-Method", "PUT")
  res.setHeader("X-Replacement-Method", replacementMethod)
  res.setHeader("X-Replacement-Path", replacementPath)
}
