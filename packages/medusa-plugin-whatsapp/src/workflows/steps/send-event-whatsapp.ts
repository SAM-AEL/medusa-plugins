import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
    createWhatsappMessageLog,
    fetchEntityData,
    getWhatsappConfig,
    resolveDataPath,
    resolvePhoneNumber,
    sendWhatsappTemplateMessage,
} from "../../shared/whatsapp-runtime"
import { normalizePhoneToE164 } from "../../shared/http"
import { redactSensitiveObject } from "../../shared/log-policy"

const WHATSAPP_MODULE = "whatsapp"

export type SendEventWhatsappStepInput = {
    event_name: string
    event_data: Record<string, any>
}

type SendEventWhatsappStepOutput = {
    sent: number
    failed: number
    skipped: number
}

export const sendEventWhatsappStep = createStep<
    SendEventWhatsappStepInput,
    SendEventWhatsappStepOutput,
    void
>(
    "send-event-whatsapp",
    async (input: SendEventWhatsappStepInput, { container }) => {
        const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
        const whatsappModule = container.resolve(WHATSAPP_MODULE)
        const whatsappConfig = await getWhatsappConfig(whatsappModule)

        if (!whatsappConfig.configured) {
            logger.warn(`[WhatsApp] Not configured, skipping event ${input.event_name}`)
            return new StepResponse({ sent: 0, failed: 0, skipped: 0 }, undefined)
        }

        const [mappings] = await (whatsappModule as any).listAndCountWhatsappEventMappings(
            { event_name: input.event_name, active: true },
            { take: 100 }
        )

        if (!mappings?.length) {
            return new StepResponse({ sent: 0, failed: 0, skipped: 0 }, undefined)
        }

        const enrichedData = await fetchEntityData(
            input.event_data,
            input.event_name,
            container,
            logger
        )

        let sent = 0
        let failed = 0
        let skipped = 0
        const rawConcurrency = Number(process.env.WHATSAPP_SEND_CONCURRENCY ?? 2)
        const concurrency = Number.isFinite(rawConcurrency)
            ? Math.max(1, Math.min(10, Math.floor(rawConcurrency)))
            : 2
        let index = 0

        const runNext = async (): Promise<void> => {
            if (index >= mappings.length) {
                return
            }

            const mapping = mappings[index++]
            let requestPayload: Record<string, any> = {}
            let responsePayload: Record<string, any> = {}
            let normalizedPhone: string | null = null

            try {
                const rawPhone = await resolvePhoneNumber(
                    enrichedData,
                    input.event_name,
                    container,
                    mapping.recipient_type || "billing_shipping",
                    mapping.recipient_phone
                )

                if (!rawPhone) {
                    skipped += 1
                    logger.warn(
                        `[WhatsApp] No phone number found for event ${input.event_name} (recipient_type: ${mapping.recipient_type})`
                    )
                    return runNext()
                }

                normalizedPhone = normalizePhoneToE164(rawPhone)
                if (!normalizedPhone) {
                    skipped += 1
                    logger.warn(`[WhatsApp] Invalid recipient phone for event ${input.event_name}`)
                    return runNext()
                }

                let templateVars: Record<string, string> = {}
                if (mapping.template_variables) {
                    if (typeof mapping.template_variables === "string") {
                        try {
                            const parsed = JSON.parse(mapping.template_variables)
                            templateVars = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
                        } catch {
                            templateVars = {}
                        }
                    } else if (typeof mapping.template_variables === "object" && !Array.isArray(mapping.template_variables)) {
                        templateVars = mapping.template_variables
                    }
                }

                const orderedKeys = Object.keys(templateVars).sort((a, b) => {
                    const na = Number(a)
                    const nb = Number(b)
                    if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb
                    return a.localeCompare(b)
                })
                const bodyParameters = orderedKeys.map((key) => {
                    const path = templateVars[key]
                    return {
                        type: "text" as const,
                        text: String(typeof path === "string" ? resolveDataPath(enrichedData, path) ?? "" : "").slice(0, 1024),
                    }
                })

                const result = await sendWhatsappTemplateMessage({
                    phoneNumberId: whatsappConfig.phoneNumberId!,
                    accessToken: whatsappConfig.accessToken!,
                    apiVersion: whatsappConfig.apiVersion,
                    recipientPhone: normalizedPhone,
                    templateName: mapping.template_name,
                    languageCode: mapping.language_code || whatsappConfig.defaultLanguageCode,
                    bodyParameters,
                })

                requestPayload = result.requestPayload
                responsePayload = result.responseData

                await createWhatsappMessageLog(container, {
                    event_name: input.event_name,
                    recipient_phone: normalizedPhone,
                    template_name: mapping.template_name,
                    status: result.response.ok ? "sent" : "failed",
                    wa_message_id: result.responseData?.messages?.[0]?.id || null,
                    error_message: result.response.ok ? null : JSON.stringify(redactSensitiveObject(result.responseData?.error || result.responseData)).slice(0, 2000),
                    request_payload: redactSensitiveObject(result.requestPayload),
                    response_payload: redactSensitiveObject(result.responseData),
                })

                if (result.response.ok) {
                    sent += 1
                    logger.info(
                        `[WhatsApp] Sent "${mapping.template_name}" for event ${input.event_name}`
                    )
                } else {
                    failed += 1
                    logger.error(`[WhatsApp] Failed to send "${mapping.template_name}"`)
                }
            } catch (err: any) {
                failed += 1
                logger.error(`[WhatsApp] Error sending message: ${err instanceof Error ? err.message : "unknown"}`)
                await createWhatsappMessageLog(container, {
                    event_name: input.event_name,
                    recipient_phone: normalizedPhone,
                    template_name: mapping.template_name,
                    status: "failed",
                    error_message: String(err instanceof Error ? err.message : "unknown").slice(0, 2000),
                    request_payload: redactSensitiveObject(requestPayload),
                    response_payload: redactSensitiveObject(responsePayload),
                })
            } finally {
                await runNext()
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrency, mappings.length) }, () => runNext())
        )

        return new StepResponse({ sent, failed, skipped }, undefined)
    }
)
