import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    fail,
    normalizePhoneToE164,
    normalizeTemplateVariables,
    ok,
    parsePagination,
} from "../../../../shared/http"

const WHATSAPP_MODULE = "whatsapp"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>)

    const [mappings, count] = await (whatsappModule as any).listAndCountWhatsappEventMappings(
        {},
        {
            take: limit,
            skip: offset,
            order: { created_at: "DESC" },
        }
    )

    return ok(res, { mappings, count })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)
    const body = req.body as Record<string, any>

    const { event_name, template_name, language_code, template_variables, active, recipient_type, recipient_phone } = body

    if (!event_name || !template_name) {
        return fail(res, 400, "INVALID_PAYLOAD", "event_name and template_name are required")
    }
    if (typeof event_name !== "string" || event_name.length > 100) {
        return fail(res, 400, "INVALID_EVENT", "event_name is invalid")
    }
    if (typeof template_name !== "string" || template_name.length > 128 || !/^[A-Za-z0-9_]+$/.test(template_name)) {
        return fail(res, 400, "INVALID_TEMPLATE", "template_name is invalid")
    }
    const VALID_RECIPIENT_TYPES = new Set(["billing", "shipping", "billing_shipping", "custom"])
    const resolvedRecipientType = recipient_type || "billing_shipping"
    if (!VALID_RECIPIENT_TYPES.has(resolvedRecipientType)) {
        return fail(res, 400, "INVALID_RECIPIENT_TYPE", "recipient_type is invalid")
    }

    const normalizedCustomPhone = resolvedRecipientType === "custom" ? normalizePhoneToE164(recipient_phone) : null
    if (resolvedRecipientType === "custom" && !normalizedCustomPhone) {
        return fail(res, 400, "INVALID_RECIPIENT", "recipient_phone is required and must be valid when recipient_type is custom")
    }

    const mapping = await (whatsappModule as any).createWhatsappEventMappings({
        event_name,
        template_name,
        language_code: typeof language_code === "string" && language_code.length <= 16 ? language_code : "en_US",
        template_variables: normalizeTemplateVariables(template_variables),
        recipient_type: resolvedRecipientType,
        recipient_phone: resolvedRecipientType === "custom" ? normalizedCustomPhone : null,
        active: active !== undefined ? active === true || active === "true" : true,
    })

    return ok(res, { mapping }, 201)
}
