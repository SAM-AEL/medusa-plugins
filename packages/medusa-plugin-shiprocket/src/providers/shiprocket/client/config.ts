const rawTimeout = Number(process.env.SHIPROCKET_API_TIMEOUT_MS ?? 15000)
export const SHIPROCKET_DEFAULT_TIMEOUT_MS = Number.isFinite(rawTimeout)
  ? Math.min(Math.max(Math.floor(rawTimeout), 1000), 60000)
  : 15000

export function isRetryableShiprocketStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
}
