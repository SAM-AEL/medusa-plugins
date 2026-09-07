import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { invalidateMailerCache } from "../../../../../subscribers/mailer-event-handler"
import {
    fail,
    isValidEmail,
    normalizeTemplateVariables,
    ok,
    setDeprecatedPutHeaders,
} from "../../../../../shared/http"

const MAILER_MODULE = "mailer"

async function updateMapping(req: MedusaRequest, res: MedusaResponse) {
    const mailerModule = req.scope.resolve(MAILER_MODULE)
    const { id } = req.params
    const body = req.body as Record<string, any>

    if (!id) {
        return fail(res, 400, "INVALID_PAYLOAD", "id parameter is required")
    }

    // Retrieve the existing mapping to merge with updates
    const [mappings] = await (mailerModule as any).listAndCountMailerEventMappings(
        { id },
        { take: 1 }
    )
    const existing = mappings?.[0]
    if (!existing) {
        return fail(res, 404, "NOT_FOUND", "Mapping not found")
    }

    // Merge existing data with incoming updates
    const mergedData: Record<string, any> = {
        event_name: body.event_name ?? existing.event_name,
        template_name: body.template_name ?? existing.template_name,
        sender_index: body.sender_index ?? existing.sender_index ?? 1,
        subject: body.subject ?? existing.subject ?? "",
        template_variables: normalizeTemplateVariables(
            body.template_variables ?? existing.template_variables ?? {}
        ),
        recipient_type: body.recipient_type ?? existing.recipient_type ?? "customer_email",
        recipient_email: (body.recipient_type ?? existing.recipient_type) === "custom"
            ? (body.recipient_email ?? existing.recipient_email)
            : null,
        active: body.active ?? existing.active,
    }

    const VALID_RECIPIENT_TYPES = new Set(["customer_email", "order_email", "custom"])
    if (typeof mergedData.event_name !== "string" || mergedData.event_name.length > 100) {
        return fail(res, 400, "INVALID_EVENT", "event_name is invalid")
    }
    if (typeof mergedData.template_name !== "string" || mergedData.template_name.length > 128 || mergedData.template_name.includes("..") || mergedData.template_name.includes("/")) {
        return fail(res, 400, "INVALID_TEMPLATE", "template_name is invalid")
    }
    if (!VALID_RECIPIENT_TYPES.has(mergedData.recipient_type)) {
        return fail(res, 400, "INVALID_RECIPIENT_TYPE", "recipient_type is invalid")
    }
    if (mergedData.recipient_type === "custom" && !isValidEmail(mergedData.recipient_email)) {
        return fail(res, 400, "INVALID_RECIPIENT", "recipient_email must be valid for custom recipient_type")
    }
    const senderIdx = Number(mergedData.sender_index ?? 1)
    if (!Number.isInteger(senderIdx) || senderIdx < 1 || senderIdx > 5) {
        return fail(res, 400, "INVALID_SENDER", "sender_index must be an integer 1..5")
    }
    mergedData.sender_index = senderIdx
    if (typeof mergedData.subject === "string") {
        mergedData.subject = mergedData.subject.replace(/[\r\n]+/g, " ").slice(0, 998)
    }
    mergedData.active = mergedData.active === true || mergedData.active === "true"

    const updated = await (mailerModule as any).updateMailerEventMappings([
        { id, ...mergedData },
    ])
    const mapping = Array.isArray(updated) ? updated[0] : updated

    invalidateMailerCache()

    return ok(res, { mapping })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    return updateMapping(req, res)
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
    setDeprecatedPutHeaders(res, "POST", "/admin/mailer/mappings/:id")
    return updateMapping(req, res)
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
    const mailerModule = req.scope.resolve(MAILER_MODULE)
    const { id } = req.params

    if (!id) {
        return fail(res, 400, "INVALID_PAYLOAD", "id parameter is required")
    }

    await (mailerModule as any).deleteMailerEventMappings(id)

    invalidateMailerCache()

    return ok(res, { id, deleted: true })
}
