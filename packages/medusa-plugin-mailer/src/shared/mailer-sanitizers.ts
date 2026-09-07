/**
 * Mailer Sanitization & Utility Functions
 * Pure functions with zero runtime dependencies for maximum resilience and security.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function isSafeWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

export function resolveDataPath(data: any, pathValue: string): any {
  if (typeof pathValue !== "string" || !/^[A-Za-z0-9_.]+$/.test(pathValue)) {
    return undefined
  }
  if (pathValue.includes("__proto__") || pathValue.includes("constructor") || pathValue.includes("prototype")) {
    return undefined
  }
  return pathValue.split(".").reduce((obj, key) => obj?.[key], data)
}

export function sanitizeSenderName(name: string): string {
  return (name || "").replace(/[\r\n]+/g, " ").trim().slice(0, 100)
}

export function sanitizeEmailAddress(email: string): string {
  return (email || "").replace(/[\r\n]+/g, "").trim().slice(0, 255)
}
