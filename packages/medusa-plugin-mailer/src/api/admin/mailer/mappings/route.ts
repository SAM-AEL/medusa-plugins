import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { invalidateMailerCache } from "../../../../subscribers/mailer-event-handler"
import { fail, isValidEmail, normalizeTemplateVariables, ok, parsePagination } from "../../../../shared/http"
import { MAILER_EVENTS } from "../../../../shared/mailer-fields"

const MAILER_MODULE = "mailer"
const VALID_RECIPIENT_TYPES = new Set(["customer_email", "order_email", "custom"])

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const mailerModule = req.scope.resolve(MAILER_MODULE)
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>)

    const [mappings, count] = await (mailerModule as any).listAndCountMailerEventMappings(
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
    const mailerModule = req.scope.resolve(MAILER_MODULE)
    const body = req.body as Record<string, any>

    const { event_name, template_name, sender_index, subject, template_variables, recipient_type, recipient_email, active } = body

    if (!event_name || !template_name) {
        return fail(res, 400, "INVALID_PAYLOAD", "event_name and template_name are required")
    }

    if (typeof event_name !== "string" || event_name.length > 100 || !MAILER_EVENTS.includes(event_name)) {
        return fail(res, 400, "INVALID_EVENT", "event_name is not a supported mailer event")
    }
    if (typeof template_name !== "string" || template_name.length > 128 || template_name.includes("..") || template_name.includes("/")) {
        return fail(res, 400, "INVALID_TEMPLATE", "template_name is invalid")
    }
    const resolvedRecipientType = recipient_type || "customer_email"
    if (!VALID_RECIPIENT_TYPES.has(resolvedRecipientType)) {
        return fail(res, 400, "INVALID_RECIPIENT_TYPE", "recipient_type must be customer_email, order_email, or custom")
    }

    if (resolvedRecipientType === "custom" && !isValidEmail(recipient_email)) {
        return fail(res, 400, "INVALID_PAYLOAD", "recipient_email must be a valid email when recipient_type is custom")
    }
    const senderIdx = Number(sender_index ?? 1)
    if (!Number.isInteger(senderIdx) || senderIdx < 1 || senderIdx > 5) {
        return fail(res, 400, "INVALID_SENDER", "sender_index must be an integer 1..5")
    }
    if (typeof subject === "string" && subject.length > 998) {
        return fail(res, 400, "INVALID_SUBJECT", "subject must be 998 chars or fewer")
    }

    const mapping = await (mailerModule as any).createMailerEventMappings({
        event_name,
        template_name,
        sender_index: senderIdx,
        subject: (subject || "").replace(/[\r\n]+/g, " ").slice(0, 998),
        template_variables: normalizeTemplateVariables(template_variables),
        recipient_type: resolvedRecipientType,
        recipient_email: resolvedRecipientType === "custom" ? String(recipient_email).trim() : null,
        active: active !== undefined ? active === true || active === "true" : true,
    })

    invalidateMailerCache()

    return ok(res, { mapping }, 201)
}
