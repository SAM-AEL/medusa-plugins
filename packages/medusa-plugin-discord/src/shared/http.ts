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

/**
 * Mask a Discord webhook URL so the bearer token never leaves the server.
 * Keeps `https://discord.com/api/webhooks/<id>/…<last4>` for identification.
 */
export function maskWebhookUrl(url: unknown): string {
  if (typeof url !== "string" || !url) return ""
  const trimmed = url.trim()
  const m = /^(https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/)([A-Za-z0-9_-]+)\/?$/.exec(trimmed)
  if (!m) return "…invalid"
  const token = m[2]
  return `${m[1]}…${token.slice(-4)}`
}

/** Strip the bearer token from a mapping object before returning it via API. */
export function toSafeMapping(mapping: Record<string, any>): Record<string, unknown> {
  const { webhook_url, ...rest } = mapping || {}
  return { ...rest, masked_url: maskWebhookUrl(webhook_url) }
}

interface RateLimitEntry {
  count: number
  windowStart: number
}

export class RateLimiter {
  private requests = new Map<string, RateLimitEntry>()
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
    const now = Date.now()
    const entry = this.requests.get(identifier)
    if (!entry || now - entry.windowStart >= this.windowMs) {
      if (this.requests.size >= 10000) this.cleanup()
      this.requests.set(identifier, { count: 1, windowStart: now })
      return true
    }
    if (entry.count >= this.maxRequests) return false
    entry.count += 1
    return true
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.windowStart >= this.windowMs) this.requests.delete(key)
    }
  }
}

export function getActorId(req: any): string {
  const actorId = req?.auth_context?.actor_id
  if (actorId) return String(actorId)
  const direct = req?.ip || req?.socket?.remoteAddress
  return direct ? String(direct) : "unknown"
}
