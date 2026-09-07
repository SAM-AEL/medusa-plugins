const QUERY_KEY = "query"
import {
    CUSTOMER_FIELDS,
    FULFILLMENT_FIELDS,
    ORDER_FIELDS,
    RETURN_FIELDS,
} from "./whatsapp-fields"

const WHATSAPP_MODULE = "whatsapp"
const rawWhatsappTimeout = Number(process.env.WHATSAPP_API_TIMEOUT_MS ?? 15000)
const WHATSAPP_API_TIMEOUT_MS = Number.isFinite(rawWhatsappTimeout)
  ? Math.min(Math.max(Math.floor(rawWhatsappTimeout), 1000), 120000)
  : 15000
let warnedAboutLegacyToken = false

export function resolveDataPath(data: any, path: string): any {
    if (typeof path !== "string" || !/^[A-Za-z0-9_.]+$/.test(path)) {
        return undefined
    }
    if (path.includes("__proto__") || path.includes("constructor") || path.includes("prototype")) {
        return undefined
    }
    return path.split(".").reduce((obj, key) => obj?.[key], data)
}

export async function getWhatsappConfig(whatsappModule: any) {
    const [configs] = await (whatsappModule as any).listAndCountWhatsappConfigs(
        { active: true },
        { take: 1 }
    )

    const config = configs?.[0]
    const phoneNumberId = config?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const rawApiVersion = config?.api_version || process.env.WHATSAPP_API_VERSION || "v25.0"
    const apiVersion = /^v\d+\.\d+$/.test(rawApiVersion) ? rawApiVersion : "v25.0"
    const defaultLanguageCode = config?.default_language_code || "en_US"

    if (phoneNumberId && !/^\d+$/.test(String(phoneNumberId))) {
        return {
            config,
            phoneNumberId: null,
            accessToken,
            apiVersion,
            defaultLanguageCode,
            configured: false,
        }
    }

    if (!accessToken && config && !warnedAboutLegacyToken) {
        warnedAboutLegacyToken = true
        // Security hardening: token persistence in DB is deprecated and no longer supported.
        // Keep warning one-time to avoid noisy logs while guiding upgrade.
        // eslint-disable-next-line no-console
        console.warn(
            "[WhatsApp] WHATSAPP_ACCESS_TOKEN is not set. Stored DB tokens are deprecated; configure env secret instead."
        )
    }

    return {
        config,
        phoneNumberId,
        accessToken,
        apiVersion,
        defaultLanguageCode,
        configured: !!(phoneNumberId && accessToken),
    }
}

export async function fetchEntityData(
    data: any,
    eventName: string,
    container: any,
    logger: any,
): Promise<Record<string, any>> {
    try {
        const query = container.resolve(QUERY_KEY)

        if (eventName.startsWith("order.")) {
            const { data: orders } = await query.graph({
                entity: "order",
                fields: ORDER_FIELDS,
                filters: { id: data.id },
            })
            return orders?.[0] || data
        }

        if (eventName.startsWith("fulfillment.")) {
            const { data: fulfillments } = await query.graph({
                entity: "fulfillment",
                fields: FULFILLMENT_FIELDS,
                filters: { id: data.id },
            })
            const fulfillment = fulfillments?.[0] || {}
            const orderId = data.order_id || fulfillment.order_id

            if (orderId) {
                const { data: orders } = await query.graph({
                    entity: "order",
                    fields: ORDER_FIELDS,
                    filters: { id: orderId },
                })
                return { ...fulfillment, order: orders?.[0] || {} }
            }

            return { ...data, ...fulfillment }
        }

        if (eventName.startsWith("customer.")) {
            const { data: customers } = await query.graph({
                entity: "customer",
                fields: CUSTOMER_FIELDS,
                filters: { id: data.id },
            })
            return customers?.[0] || data
        }

        if (eventName.startsWith("return.")) {
            const { data: returns } = await query.graph({
                entity: "return",
                fields: RETURN_FIELDS,
                filters: { id: data.id },
            })
            const ret = returns?.[0] || {}
            const orderId = data.order_id || ret.order_id

            if (orderId) {
                const { data: orders } = await query.graph({
                    entity: "order",
                    fields: ORDER_FIELDS,
                    filters: { id: orderId },
                })
                return { ...ret, order: orders?.[0] || {} }
            }

            return { ...data, ...ret }
        }

        if (eventName.startsWith("claim.") || eventName.startsWith("exchange.")) {
            const entity = eventName.startsWith("claim.") ? "claim" : "exchange"
            const { data: items } = await query.graph({
                entity,
                fields: ["id", "type", "order_id"],
                filters: { id: data.id },
            })
            const item = items?.[0] || {}
            const orderId = data.order_id || item.order_id

            if (orderId) {
                const { data: orders } = await query.graph({
                    entity: "order",
                    fields: ORDER_FIELDS,
                    filters: { id: orderId },
                })
                return { ...item, order: orders?.[0] || {} }
            }

            return { ...data, ...item }
        }

        return data
    } catch (err: any) {
        logger.warn(`[WhatsApp] Could not fetch entity data for ${eventName}: ${err.message}`)
        return data
    }
}

export async function resolvePhoneNumber(
    data: any,
    eventName: string,
    container: any,
    recipientType: string,
    recipientPhone?: string | null
): Promise<string | null> {
    if (recipientType === "custom") {
        return recipientPhone || null
    }

    if (!eventName.startsWith("order.") && !eventName.startsWith("fulfillment.")) {
        if (data.phone) return data.phone
        if (data.customer?.phone) return data.customer.phone
        return null
    }

    const orderId = eventName.startsWith("order.") ? data.id : data.order_id
    if (!orderId) return null

    try {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: orders } = await query.graph({
            entity: "order",
            fields: [
                "id",
                "billing_address.phone",
                "shipping_address.phone",
                "customer.phone",
            ],
            filters: { id: orderId },
        })

        const order = orders?.[0]
        if (!order) return null

        const billingPhone = order.billing_address?.phone
        const shippingPhone = order.shipping_address?.phone
        const customerPhone = order.customer?.phone

        switch (recipientType) {
            case "billing":
                return billingPhone || customerPhone || null
            case "shipping":
                return shippingPhone || customerPhone || null
            case "billing_shipping":
            default:
                return billingPhone || shippingPhone || customerPhone || null
        }
    } catch {
        return null
    }
}

export async function sendWhatsappTemplateMessage({
    phoneNumberId,
    accessToken,
    apiVersion,
    recipientPhone,
    templateName,
    languageCode,
    bodyParameters,
}: {
    phoneNumberId: string
    accessToken: string
    apiVersion: string
    recipientPhone: string
    templateName: string
    languageCode: string
    bodyParameters?: Array<{ type: "text"; text: string }>
}) {
    const components =
        bodyParameters && bodyParameters.length > 0
            ? [{ type: "body", parameters: bodyParameters }]
            : []

    const requestPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "template",
        template: {
            name: templateName,
            language: {
                code: languageCode,
            },
            ...(components.length > 0 ? { components } : {}),
        },
    }

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WHATSAPP_API_TIMEOUT_MS)
    let response: Response | null = null
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify(requestPayload),
        })
    } finally {
        clearTimeout(timeout)
    }

    if (!response) {
        throw new Error("WhatsApp request failed before response")
    }

    const responseData = await response.json()

    return {
        url,
        requestPayload,
        response,
        responseData,
    }
}

export async function createWhatsappMessageLog(
    container: any,
    input: Record<string, any>
) {
    const whatsappModule = container.resolve(WHATSAPP_MODULE)
    return await (whatsappModule as any).createWhatsappMessageLogs(input)
}
