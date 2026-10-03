import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { maskPhone, ok, parsePagination } from "../../../../shared/http"
import { redactSensitiveObject } from "../../../../shared/log-policy"

const WHATSAPP_MODULE = "whatsapp"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>, 20)

    const filters: any = {}
    if (typeof req.query.q === "string" && req.query.q.trim()) {
        // Escape LIKE wildcards so a search for "%" cannot match everything,
        // and cap length to keep the leading-% scan bounded.
        const q = req.query.q.trim().slice(0, 32).replace(/[%_\\]/g, (c) => `\\${c}`)
        filters.recipient_phone = { $like: `%${q}%` }
    }

    const [logs, count] = await (whatsappModule as any).listAndCountWhatsappMessageLogs(
        filters,
        {
            take: limit,
            skip: offset,
            order: { created_at: "DESC" },
        }
    )

    // WhatsApp wamids are base64 protobuf blobs that embed the recipient phone
// number. Decoding one recovers the full number, so it must be truncated
// before it leaves the server. The raw column stays in the DB so operators can
// still correlate against Meta's delivery receipts.
function redactWamid(value: unknown): string | null {
    if (typeof value !== "string" || !value) {
        return null
    }
    // Keep only a short prefix/suffix fingerprint for identification.
    return value.length <= 16 ? "…" : `${value.slice(0, 8)}…${value.slice(-4)}`
}

// Mask recipient_phone at the API boundary. The raw value stays in the DB so
    // the `?q=` search filter above keeps working, but it is never returned to
    // the browser. redactSensitiveObject() only walks nested payload objects,
    // so it does not cover these top-level columns.
    const sanitizedLogs = (logs || []).map((entry: Record<string, unknown>) => ({
        ...entry,
        recipient_phone: maskPhone(entry.recipient_phone),
        wa_message_id: redactWamid(entry.wa_message_id),
        request_payload: redactSensitiveObject(entry.request_payload),
        response_payload: redactSensitiveObject(entry.response_payload),
    }))

    return ok(res, { logs: sanitizedLogs, count })
}
