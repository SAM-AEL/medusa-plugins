const rawTimeout = Number(process.env.PAYU_API_TIMEOUT_MS ?? 30000)
export const PAYU_DEFAULT_TIMEOUT_MS = Number.isFinite(rawTimeout)
  ? Math.min(Math.max(Math.floor(rawTimeout), 2000), 60000)
  : 30000

export function isRetryablePayuStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
}
