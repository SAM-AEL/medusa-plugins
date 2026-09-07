const SENSITIVE_SUBSTRING_KEYS = [
  "authorization",
  "access_token",
  "password",
  "phone",
  "recipient_phone",
  "secret",
  "token",
]

const EXACT_SENSITIVE_KEYS = new Set([
  "to",
  "hash",
])

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (EXACT_SENSITIVE_KEYS.has(lower)) {
    return true
  }
  return SENSITIVE_SUBSTRING_KEYS.some((token) => lower.includes(token))
}

function redactValue(value: unknown): string {
  return "[REDACTED]"
}

export function redactSensitiveObject(input: unknown, depth = 0): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }
  if (depth > 5) {
    return { "[nested]": "[REDACTED]" }
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = redactValue(value)
      continue
    }
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        out[key] = (value as unknown[]).slice(0, 50).map((item) =>
          item && typeof item === "object" ? redactSensitiveObject(item, depth + 1) : item
        )
      } else {
        out[key] = redactSensitiveObject(value, depth + 1)
      }
      continue
    }
    out[key] = value
  }
  return out
}
