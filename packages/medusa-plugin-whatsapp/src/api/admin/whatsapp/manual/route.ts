import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
    createWhatsappMessageLog,
    getWhatsappConfig,
    sendWhatsappTemplateMessage,
} from "../../../../shared/whatsapp-runtime"
import {
    fail,
    getActorId,
    normalizePhoneToE164,
    normalizeTemplateVariables,
    ok,
    RateLimiter,
} from "../../../../shared/http"
import { redactSensitiveObject } from "../../../../shared/log-policy"

const WHATSAPP_MODULE = "whatsapp"

/**
 * Bound manual sends per authenticated admin: 30/hour. This endpoint accepts an
 * arbitrary destination number, so without a cap a leaked admin credential could
 * send arbitrary WhatsApp messages on the business's account.
 */
const manualSendRateLimiter = new RateLimiter(30, 60 * 60 * 1000)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

    if (!manualSendRateLimiter.isAllowed(getActorId(req))) {
        logger.warn("[WhatsApp] Manual send rate limit exceeded")
        return fail(res, 429, "RATE_LIMITED", "Too many manual sends. Try again later.")
    }

    const body = req.body as Record<string, any>

    const { phone_number, template_name, language_code, template_variables } = body

    if (!phone_number || !template_name) {
        return fail(res, 400, "INVALID_PAYLOAD", "phone_number and template_name are required")
    }

    const normalizedPhone = normalizePhoneToE164(phone_number)
    if (!normalizedPhone) {
        return fail(res, 400, "INVALID_RECIPIENT", "phone_number must be a valid international phone number (E.164 digits)")
    }
    if (typeof template_name !== "string" || template_name.length > 128 || !/^[A-Za-z0-9_]+$/.test(template_name)) {
        return fail(res, 400, "INVALID_TEMPLATE", "template_name is invalid")
    }

    const whatsappConfig = await getWhatsappConfig(whatsappModule)
    const config = whatsappConfig.config

    if (!whatsappConfig.configured) {
        return fail(
            res,
            400,
            "WHATSAPP_NOT_CONFIGURED",
            "WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN."
        )
    }

    const normalizedVars = normalizeTemplateVariables(template_variables)
    // Meta body params are positional: sort numeric keys numerically so
    // {{1}},{{2}} map to the intended values instead of insertion order.
    const orderedKeys = Object.keys(normalizedVars).sort((a, b) => {
        const na = Number(a)
        const nb = Number(b)
        if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb
        return a.localeCompare(b)
    })
    const bodyParams = orderedKeys.length > 0
        ? orderedKeys.map((key) => ({
            type: "text" as const,
            text: String(normalizedVars[key]).slice(0, 1024),
        }))
        : []

    let requestPayload: Record<string, any> = {}

    try {
        const { url, requestPayload: payload, response, responseData } =
            await sendWhatsappTemplateMessage({
                phoneNumberId: whatsappConfig.phoneNumberId!,
                accessToken: whatsappConfig.accessToken!,
                apiVersion: whatsappConfig.apiVersion,
                recipientPhone: normalizedPhone,
                templateName: template_name,
                languageCode: language_code || config?.default_language_code || "en_US",
                bodyParameters: bodyParams,
            })
        requestPayload = payload

        // Log the message
        const messageLog = await createWhatsappMessageLog(req.scope, {
            event_name: "test_message",
            recipient_phone: normalizedPhone,
            template_name,
            status: response.ok ? "sent" : "failed",
            wa_message_id: responseData?.messages?.[0]?.id || null,
            error_message: response.ok ? null : JSON.stringify(redactSensitiveObject(responseData?.error || responseData)).slice(0, 2000),
            request_payload: redactSensitiveObject(requestPayload),
            response_payload: redactSensitiveObject(responseData),
        })

        if (response.ok) {
            logger.info(`[WhatsApp] Test message sent using template ${template_name}`)
            return ok(res, { log: messageLog, response: redactSensitiveObject(responseData) })
        } else {
            logger.error(`[WhatsApp] Test message failed`)
            return fail(res, 400, "SEND_FAILED", "WhatsApp test message failed", {
                log: messageLog,
                error: redactSensitiveObject(responseData),
            })
        }
    } catch (error: any) {
        logger.error(`[WhatsApp] Test message error: ${error instanceof Error ? error.message : "unknown"}`)

        await createWhatsappMessageLog(req.scope, {
            event_name: "test_message",
            recipient_phone: normalizedPhone,
            template_name,
            status: "failed",
            error_message: String(error instanceof Error ? error.message : "unknown").slice(0, 2000),
            request_payload: redactSensitiveObject(requestPayload),
            response_payload: {},
        })

        return fail(res, 500, "SEND_FAILED", "Failed to send WhatsApp test message")
    }
}
