import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DISCORD_NOTIFICATION_MODULE } from "../modules/discord-notification"

type EventPayload = {
    id: string
    order_id?: string
}

function getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

function extractNumeric(value: any): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") return Number(value);
    if (typeof value === "object" && value !== null) {
        if ("numeric_" in value) return Number(value.numeric_);
        if ("raw_" in value && value.raw_ !== null && "value" in value.raw_) return Number(value.raw_.value);
        if ("value" in value) return Number(value.value);
        if (typeof value.valueOf === "function") {
            const val = value.valueOf();
            if (typeof val === "number" || typeof val === "string") return Number(val);
        }
    }
    return Number(value);
}

/** Medusa money fields are integer minor units; Discord display needs major units. */
export function toMajorUnits(minor: number): number {
    if (!Number.isFinite(minor)) return 0;
    return minor / 100;
}

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
export function getCurrencyFormatter(currencyCode: unknown): Intl.NumberFormat {
    const raw = typeof currencyCode === "string" && currencyCode.trim() ? currencyCode.trim().toUpperCase() : "USD";
    const cached = currencyFormatterCache.get(raw);
    if (cached) return cached;
    let formatter: Intl.NumberFormat;
    try {
        formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: raw });
    } catch {
        formatter = new Intl.NumberFormat("en-US");
    }
    currencyFormatterCache.set(raw, formatter);
    return formatter;
}

/**
 * Escape Discord markdown + neutralize @everyone/@here pings from user-controlled data.
 *
 * Imported from shared/discord-fields, which is now the single canonical
 * implementation. A near-duplicate used to live here with a narrower escape
 * set, which risked the two drifting apart.
 */
import { discordEscape, DISCORD_SUBSCRIBER_CONFIG } from "../shared/discord-fields"

export { discordEscape }

function isSafeHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * PII is redacted from default embeds unless the operator explicitly opts in
 * via DISCORD_INCLUDE_PII=true. Discord messages persist outside GDPR
 * retention controls, so email/phone are opt-in, not opt-out.
 */
const INCLUDE_PII = process.env.DISCORD_INCLUDE_PII === "true"

function escapeMarkdownUrl(url: string): string {
    return String(url).replace(/[()]/g, (c) => encodeURIComponent(c))
}

function capEmbed(embed: any): any {
    const out = { ...embed }
    if (typeof out.title === "string") out.title = out.title.slice(0, 256)
    if (typeof out.description === "string") out.description = out.description.slice(0, 4096)
    if (Array.isArray(out.fields)) {
        out.fields = out.fields.slice(0, 25).map((f: any) => ({
            ...f,
            name: typeof f?.name === "string" ? f.name.slice(0, 256) : f?.name,
            value: typeof f?.value === "string" ? f.value.slice(0, 1024) : f?.value,
        }))
    }
    if (out.footer && typeof out.footer.text === "string") {
        out.footer = { ...out.footer, text: discordEscape(out.footer.text).slice(0, 2048) }
    }
    return out
}

async function discordFetch(url: string, init: RequestInit, timeoutMs = 8000, retries = 1): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            if (res.status === 429 && attempt < retries) {
                const retryAfterMs = Math.min(Number(res.headers.get("retry-after") || "1") * 1000, 10000);
                await new Promise((r) => setTimeout(r, Number.isFinite(retryAfterMs) ? retryAfterMs : 1000));
                continue;
            }
            return res;
        } catch (e) {
            lastError = e;
            if (attempt === retries) throw e;
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Discord request failed");
}

/** Build a Discord payload that never lets templates override identity/mentions. */
function finalizeDiscordPayload(identity: { username: string; avatar_url?: string }, parsedJson: any, fallbackContent: string) {
    const { username: _u, avatar_url: _a, allowed_mentions: _m, tts: _t, ...safe } = parsedJson || {};
    const content = typeof safe.content === "string" ? safe.content.slice(0, 2000) : undefined;
    const embeds = Array.isArray(safe.embeds) ? safe.embeds.slice(0, 10).map(capEmbed) : undefined;
    if (content === undefined && embeds === undefined) {
        return { ...identity, allowed_mentions: { parse: [] }, content: fallbackContent.slice(0, 2000) };
    }
    return {
        ...identity,
        allowed_mentions: { parse: [] },
        ...(content !== undefined ? { content } : {}),
        ...(embeds !== undefined ? { embeds } : {}),
    };
}

function formatValue(value: any, path: string, rootData?: any): string {
    if (value === undefined || value === null) {
        return "";
    }
    
    const isPrice = path === "total" || path === "subtotal" || path.endsWith(".total") || path.endsWith(".subtotal") || path.endsWith(".price") || path.endsWith(".unit_price");
    
    if (isPrice) {
        const num = extractNumeric(value);
        if (!isNaN(num) && rootData) {
            const formatter = getCurrencyFormatter((rootData as any).currency_code);
            return formatter.format(toMajorUnits(num));
        }
        return isNaN(num) ? "0" : num.toString();
    }

    if (typeof value === "number") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        if (path === "items" || path.endsWith(".items")) {
            return value.map((item: any) => {
                if (typeof item === "object" && item !== null) {
                    const title = item.title || item.name || "Item";
                    const qty = item.quantity !== undefined ? ` (Qty: ${item.quantity})` : "";
                    
                    let priceStr = "";
                    if (item.unit_price !== undefined) {
                        const pNum = extractNumeric(item.unit_price);
                        if (!isNaN(pNum)) {
                            if (rootData) {
                                const formatter = getCurrencyFormatter((rootData as any).currency_code);
                                priceStr = ` - ${formatter.format(toMajorUnits(pNum))}`;
                            } else {
                                priceStr = ` - ${pNum}`;
                            }
                        }
                    }
                    return `- ${title}${qty}${priceStr}`;
                }
                return `- ${String(item)}`;
            }).join("\n");
        }
        return value.map(val => String(val)).join(", ");
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

function compileTemplate(template: string, data: any): string {
    const isJson = template.trim().startsWith("{") && template.trim().endsWith("}");
    return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, path) => {
        const value = getNestedValue(data, path);
        let formatted = formatValue(value, path, data);
        // Escape interpolated values so customer-controlled data cannot inject
        // Discord markdown, block quotes, tables, or @everyone/@here pings.
        // In JSON mode the escaping below must happen first so the backslashes
        // are themselves escaped for valid JSON.
        formatted = discordEscape(formatted);
        if (isJson && typeof formatted === "string") {
            formatted = formatted.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        }
        return formatted;
    });
}

// Safely resolve the Order ID from different Medusa event structures
async function resolveOrderId(name: string, data: any, query: any, logger: any): Promise<string | null> {
    if (!data) return null

    if (data.order_id) {
        return data.order_id
    }

    if (data.id) {
        // 1. Try to fetch as direct Order ID
        try {
            const { data: orders } = await query.graph({
                entity: "order",
                fields: ["id"],
                filters: { id: data.id },
            })
            if (orders && orders.length > 0) {
                return orders[0].id
            }
        } catch (e) {
            // Not a direct order
        }

        // 2. Try to fetch as Fulfillment ID linked to an order
        try {
            const { data: linkedOrders } = await query.graph({
                entity: "order",
                fields: ["id"],
                filters: {
                    fulfillments: {
                        id: data.id
                    }
                }
            })
            if (linkedOrders && linkedOrders.length > 0) {
                return linkedOrders[0].id
            }
        } catch (e) {
            // Not a fulfillment ID linked to order
        }

        // 3. Try to fetch as Payment ID linked to an order
        try {
            const { data: payments } = await query.graph({
                entity: "payment",
                fields: ["id", "payment_collection_id"],
                filters: { id: data.id }
            })
            if (payments && payments.length > 0 && payments[0].payment_collection_id) {
                const { data: linkedOrders } = await query.graph({
                    entity: "order",
                    fields: ["id"],
                    filters: {
                        payment_collections: {
                            id: payments[0].payment_collection_id
                        }
                    }
                })
                if (linkedOrders && linkedOrders.length > 0) {
                    return linkedOrders[0].id
                }
            }
        } catch (e) {
            // Not a payment ID
        }

        // 4. Try to fetch as Payment Collection ID linked to an order
        try {
            const { data: linkedOrders } = await query.graph({
                entity: "order",
                fields: ["id"],
                filters: {
                    payment_collections: {
                        id: data.id
                    }
                }
            })
            if (linkedOrders && linkedOrders.length > 0) {
                return linkedOrders[0].id
            }
        } catch (e) {
            logger.warn(`Could not resolve order from ID ${data.id}: ${e}`)
        }
    }

    return null
}

export default async function discordNotificationHandler({
    event: { name, data },
    container,
}: SubscriberArgs<EventPayload>) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const discordSvc = container.resolve(DISCORD_NOTIFICATION_MODULE) as any
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    try {
        const globalSettings = await discordSvc.getSettings()

        // Handle Customer Events separately (not order-centric, always new messages)
        if (name.startsWith("customer.")) {
            const mappings = await discordSvc.listDiscordWebhookMappings({
                event_name: name,
                is_active: true,
            })

            if (!mappings || mappings.length === 0) {
                return
            }

            const { data: customers } = await query.graph({
                entity: "customer",
                fields: ["id", "email", "first_name", "last_name", "phone"],
                filters: { id: data.id },
            })

            const customer = customers?.[0]
            if (!customer) {
                logger.warn(`Customer ${data.id} not found when trying to send Discord notification`)
                return
            }

            const nameStr = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "New Customer"
            const title = name === "customer.created" ? "👤 New Customer Registered" :
                          name === "customer.updated" ? "👤 Customer Profile Updated" :
                          `👤 Customer Event: ${name}`
            const description = name === "customer.created" ? `A new customer account has been created on the storefront.` :
                                `Customer account **${customer.id}** was updated.`

            const defaultPayload = {
                username: discordEscape(discordSvc.getDefaultBotName()).slice(0, 80),
                allowed_mentions: { parse: [] },
                embeds: [
                    capEmbed({
                        title: discordEscape(title).slice(0, 256),
                        description: discordEscape(description).slice(0, 4096),
                        color: 3447003, // Blue
                        fields: [
                            { name: "Name", value: (INCLUDE_PII ? discordEscape(nameStr) : "Redacted").slice(0, 1024) || "New Customer", inline: true },
                            { name: "Email", value: (INCLUDE_PII ? discordEscape(customer.email || "N/A") : "Redacted").slice(0, 1024), inline: true }
                        ],
                        timestamp: new Date().toISOString(),
                        footer: { text: discordEscape(globalSettings.footer_text || "Your Store").slice(0, 2048) }
                    })
                ]
            }

            if (globalSettings.avatar_url) {
                (defaultPayload as any).avatar_url = globalSettings.avatar_url;
            }

            await Promise.all(
                mappings.map(async (mapping: any) => {
                    try {
                        let finalPayload: any
                        const identity = {
                            username: mapping.bot_name || discordSvc.getDefaultBotName(),
                            ...(globalSettings.avatar_url ? { avatar_url: globalSettings.avatar_url } : {}),
                        }
                        if (mapping.message_template) {
                            const content = compileTemplate(mapping.message_template, customer)
                            try {
                                const parsedJson = JSON.parse(content)
                                finalPayload = finalizeDiscordPayload(identity, parsedJson, content)
                            } catch (e) {
                                finalPayload = {
                                    ...identity,
                                    allowed_mentions: { parse: [] },
                                    content: content.slice(0, 2000)
                                }
                            }
                        } else {
                            finalPayload = {
                                ...defaultPayload,
                                username: mapping.bot_name || discordSvc.getDefaultBotName(),
                            }
                        }

                        await discordFetch(mapping.webhook_url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(finalPayload),
                        })
                    } catch (e) {
                        // Never log mapping.webhook_url — a Discord webhook URL IS the credential.
                        // Log the channel name instead, matching the delivery-failure path below.
                        logger.error(`Error sending customer notification to ${mapping.channel_name || "unnamed"}: ${e instanceof Error ? e.message : "unknown"}`)
                    }
                })
            )
            return
        }

        // Handle Order/Fulfillment/Shipment Events (Support editing the same message)
        const orderId = await resolveOrderId(name, data, query, logger)
        if (!orderId) {
            return
        }

        // Fetch complete order details
        const { data: orders } = await query.graph({
            entity: "order",
            fields: [
                "id",
                "display_id",
                "status",
                "payment_status",
                "fulfillment_status",
                "email",
                "currency_code",
                "total",
                "subtotal",
                "summary.*",
                "shipping_address.first_name",
                "shipping_address.last_name",
                "shipping_address.phone",
                "shipping_address.city",
                "billing_address.first_name",
                "billing_address.last_name",
                "billing_address.phone",
                "customer.first_name",
                "customer.last_name",
                "customer.email",
                "customer.phone",
                "items.title",
                "items.quantity",
                "items.unit_price",
                "items.thumbnail",
                "fulfillments.id",
                "fulfillments.shipped_at",
                "fulfillments.delivered_at",
                "fulfillments.canceled_at",
                "fulfillments.labels.tracking_number",
                "fulfillments.labels.tracking_url",
                "fulfillments.provider_id",
            ],
            filters: { id: orderId },
        })

        const order = orders?.[0]
        if (!order) {
            logger.warn(`Order ${orderId} not found when trying to send Discord notification`)
            return
        }

        // Format and compile order status & tracking info
        let rawPaymentStatus = order.payment_status || "awaiting"
        if (name === "payment.captured") rawPaymentStatus = "captured"
        if (name === "payment.refunded") rawPaymentStatus = "refunded"
        const paymentStatusFormatted = rawPaymentStatus.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
        
        let rawFulfillmentStatus = order.fulfillment_status || "not_fulfilled"
        if (name === "fulfillment.created") rawFulfillmentStatus = "fulfilled"
        const fulfillmentStatusFormatted = rawFulfillmentStatus.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
        
        let orderStatus = order.status || "pending"
        if (name === "order.canceled") orderStatus = "canceled"
        if (name === "order.completed") orderStatus = "completed"
        
        let shipmentStatus = "Pending"
        const trackingNumbers: string[] = []
        const trackingLinks: string[] = []
        
        if (order.fulfillments && order.fulfillments.length > 0) {
            const shippedFulfillments = order.fulfillments.filter((f: any) => f.shipped_at && !f.canceled_at)
            if (shippedFulfillments.length > 0) {
                shipmentStatus = "Shipped"
                for (const f of shippedFulfillments) {
                    if (f.labels && f.labels.length > 0) {
                        for (const l of f.labels) {
                            if (l.tracking_number) {
                                const safeNumber = discordEscape(l.tracking_number).slice(0, 100)
                                trackingNumbers.push(safeNumber)
                                if (l.tracking_url && isSafeHttpUrl(String(l.tracking_url))) {
                                    trackingLinks.push(`[${safeNumber}](${escapeMarkdownUrl(l.tracking_url)})`)
                                } else {
                                    trackingLinks.push(safeNumber)
                                }
                            }
                        }
                    }
                }
            } else if (order.fulfillments.some((f: any) => !f.canceled_at)) {
                shipmentStatus = "Fulfillment Created"
            }
        }

        let calculatedTotal = extractNumeric(order.total)
        if (!Number.isFinite(calculatedTotal)) calculatedTotal = 0
        if (calculatedTotal === 0 && order.summary?.original_order_total) {
            const fallback = extractNumeric(order.summary.original_order_total)
            if (Number.isFinite(fallback)) calculatedTotal = fallback
        } else if (calculatedTotal === 0 && extractNumeric(order.subtotal) > 0) {
            calculatedTotal = extractNumeric(order.subtotal)
        }

        const dataForTemplate = {
            ...order,
            total: calculatedTotal,
            status: orderStatus,
            payment_status: paymentStatusFormatted,
            fulfillment_status: fulfillmentStatusFormatted,
            shipment_status: shipmentStatus,
            tracking_numbers: trackingNumbers.join(", ") || "N/A",
            tracking_links: trackingLinks.join(", ") || "N/A",
            thumbnail: order.items?.[0]?.thumbnail || "",
        }

        // Use proper locale formatting based on the currency code (guarded; never throws)
        const formatter = getCurrencyFormatter((order as any).currency_code)

        const formattedTotal = formatter.format(toMajorUnits(calculatedTotal))

        const itemsDescription = (order.items
            ?.map((item: any) => {
                const qty = item.quantity !== undefined ? ` (Qty: ${item.quantity})` : ""
                const unitNum = extractNumeric(item.unit_price)
                const price = item.unit_price !== undefined && Number.isFinite(unitNum) ? ` - ${formatter.format(toMajorUnits(unitNum))}` : ""
                return `- ${discordEscape(item.title).slice(0, 200)}${qty}${price}`
            })
            .join("\n") || "No items listed.").slice(0, 4000)

        let orderStatusEmoji = "🟡"
        let color = 3447003 // Blue for placed
        if (orderStatus === "completed") {
            orderStatusEmoji = "🟢"
            color = 3066993 // Green
        } else if (orderStatus === "canceled") {
            orderStatusEmoji = "🔴"
            color = 15158332 // Red
        } else if (shipmentStatus === "Shipped") {
            color = 15105570 // Orange
        }

        const orderStatusStr = `${orderStatus.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} ${orderStatusEmoji}`

        let paymentStatusEmoji = "🟡"
        if (rawPaymentStatus === "captured") paymentStatusEmoji = "🟢"
        if (rawPaymentStatus === "refunded") paymentStatusEmoji = "🔴"
        const paymentStatusStr = `${paymentStatusFormatted} ${paymentStatusEmoji}`

        let fulfillmentEmoji = "🔴"
        if (rawFulfillmentStatus === "fulfilled") fulfillmentEmoji = "🟢"
        else if (rawFulfillmentStatus === "partially_fulfilled") fulfillmentEmoji = "🟡"

        let shipmentStr = "Pending 📦"
        if (shipmentStatus === "Shipped") {
            shipmentStr = "Shipped 🚚"
            if (trackingNumbers.length > 0) {
                shipmentStr += `\n**Tracking:** ${trackingLinks.join(", ")}`
            }
        } else if (shipmentStatus === "Fulfillment Created") {
            shipmentStr = "Fulfillment Created 📦"
        }

        const customerFirst = INCLUDE_PII ? discordEscape(order.shipping_address?.first_name || order.customer?.first_name || "") : "Redacted"
        const customerLast = INCLUDE_PII ? discordEscape(order.shipping_address?.last_name || order.customer?.last_name || "") : ""
        const customerEmail = INCLUDE_PII ? discordEscape(order.email || "N/A") : "redacted"
        const defaultEmbed: any = {
            title: `📦 Order #${order.display_id || String(order.id || "").slice(-6).toUpperCase()}`,
            color: color,
            fields: [
                { name: "Order Status", value: orderStatusStr.slice(0, 1024), inline: true },
                { name: "Payment Status", value: paymentStatusStr.slice(0, 1024), inline: true },
                { name: "Fulfillment Status", value: `${fulfillmentStatusFormatted} ${fulfillmentEmoji}`.slice(0, 1024), inline: true },
                { name: "Shipment / Delivery", value: shipmentStr.slice(0, 1024), inline: false },
                { name: "Customer Info", value: `${customerFirst} ${customerLast} (${customerEmail})`.slice(0, 1024), inline: false },
                { name: "Total Amount", value: `**${formattedTotal}**`.slice(0, 1024), inline: true },
                { name: "Items Ordered", value: itemsDescription.slice(0, 4000) || "No items listed.", inline: false }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: discordEscape(globalSettings.footer_text || "Your Store").slice(0, 2048) }
        }

        // Add thumbnail only for safe https URLs
        if (order.items?.[0]?.thumbnail && isSafeHttpUrl(String(order.items[0].thumbnail))) {
            defaultEmbed.thumbnail = { url: String(order.items[0].thumbnail) }
        }

        const defaultEmbedCapped = capEmbed(defaultEmbed)

        const buildPayload = (template: string | null, botName?: string) => {
            const resolvedBotName = discordEscape(botName || discordSvc.getDefaultBotName()).slice(0, 80)
            const identity = {
                username: resolvedBotName,
                ...(globalSettings.avatar_url ? { avatar_url: globalSettings.avatar_url } : {}),
            }
            if (template) {
                const content = compileTemplate(template, dataForTemplate)
                // Try parsing the template as JSON to allow users to build custom rich embeds
                try {
                    const parsedJson = JSON.parse(content)
                    return finalizeDiscordPayload(identity, parsedJson, content)
                } catch (e) {
                    // Not JSON, send as plain text
                    return {
                        ...identity,
                        allowed_mentions: { parse: [] },
                        content: content.slice(0, 2000)
                    }
                }
            } else {
                return {
                    ...identity,
                    allowed_mentions: { parse: [] },
                    embeds: [defaultEmbedCapped]
                }
            }
        }

        // 1. EDIT EXISTING MESSAGES SENT FOR THIS ORDER
        const existingMessages = await discordSvc.listDiscordOrderMessages({
            order_id: orderId,
        }, { take: 50 })

        const activeWebhookUrls = new Set<string>()

        if (existingMessages && existingMessages.length > 0) {
            // Single batched lookup instead of one query per tracked message (N+1).
            const trackedUrls = Array.from(new Set(existingMessages.map((m: any) => m.webhook_url).filter(Boolean)))
            const activeMappings = trackedUrls.length
                ? await discordSvc.listDiscordWebhookMappings({ webhook_url: trackedUrls, is_active: true }, { take: 100 })
                : []
            const mappingsByUrl = new Map<string, any[]>()
            for (const m of activeMappings || []) {
                const list = mappingsByUrl.get(m.webhook_url) || []
                list.push(m)
                mappingsByUrl.set(m.webhook_url, list)
            }
            await Promise.all(
                existingMessages.map(async (msg: any) => {
                    activeWebhookUrls.add(msg.webhook_url)

                    // Find if there is an active mapping for this URL
                    const mappings = mappingsByUrl.get(msg.webhook_url) || []

                    if (!mappings || mappings.length === 0) {
                        return // mapping disabled or deleted
                    }

                    // Choose template: use current event's template, or any template from active mappings on this URL
                    const currentEventMapping = mappings.find((m: any) => m.event_name === name)
                    const template = currentEventMapping?.message_template ||
                                     mappings.find((m: any) => m.message_template)?.message_template ||
                                     null
                    const botName = currentEventMapping?.bot_name ||
                                    mappings.find((m: any) => m.bot_name)?.bot_name ||
                                    undefined

                    const editPayload = buildPayload(template, botName)

                    try {
                        const editUrl = new URL(`messages/${msg.message_id}`, msg.webhook_url.endsWith("/") ? msg.webhook_url : `${msg.webhook_url}/`)
                        const response = await discordFetch(editUrl.toString(), {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(editPayload),
                        })

                        if (response.status === 404) {
                            // Message was deleted on Discord, clear mapping record
                            await discordSvc.deleteDiscordOrderMessages(msg.id)
                            activeWebhookUrls.delete(msg.webhook_url) // trigger a new post below
                        } else if (!response.ok) {
                            const err = await response.text()
                            logger.error(`Failed to edit Discord message ${msg.message_id}: status ${response.status}`)
                        }
                    } catch (e) {
                        logger.error(`Error editing Discord message ${msg.message_id}: ${e instanceof Error ? e.message : "unknown"}`)
                    }
                })
            )
        }

        // 2. SEND NEW MESSAGES FOR NEW MAPPINGS TRIGGERED BY THIS EVENT
        const mappingsForEvent = await discordSvc.listDiscordWebhookMappings({
            event_name: name,
            is_active: true,
        }, { take: 100 })

        if (mappingsForEvent && mappingsForEvent.length > 0) {
            await Promise.all(
                mappingsForEvent.map(async (mapping: any) => {
                    // Only post a new message if we haven't already edited a message on this URL
                    if (activeWebhookUrls.has(mapping.webhook_url)) {
                        return
                    }

                    const newPayload = buildPayload(mapping.message_template, mapping.bot_name || undefined)

                    try {
                        const response = await discordFetch(`${mapping.webhook_url}?wait=true`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(newPayload),
                        })

                        if (!response.ok) {
                            const err = await response.text()
                            logger.error(`Failed sending Discord webhook to channel ${mapping.channel_name || "unnamed"}: status ${response.status}`)
                            return
                        }

                        let responseData: any = null
                        try {
                            responseData = await response.json()
                        } catch {
                            logger.error(`Discord returned non-JSON response for channel ${mapping.channel_name || "unnamed"}`)
                            return
                        }
                        if (responseData && typeof responseData.id === "string") {
                            // Store the reference (duplicates guarded by unique index; ignore conflicts)
                            try {
                                await discordSvc.createDiscordOrderMessages({
                                    order_id: orderId,
                                    webhook_url: mapping.webhook_url,
                                    message_id: responseData.id,
                                })
                            } catch (e) {
                                logger.error(`Failed storing Discord message reference: ${e instanceof Error ? e.message : "unknown"}`)
                            }
                        } else {
                            logger.error(`Discord response missing message id for channel ${mapping.channel_name || "unnamed"}`)
                        }
                    } catch (e) {
                        logger.error(`Error posting new Discord webhook: ${e instanceof Error ? e.message : "unknown"}`)
                    }
                })
            )
        }

    } catch (err) {
        logger.error(`Error executing Discord notification subscriber: ${err instanceof Error ? err.message : "unknown"}`)
    }
}

export const config: SubscriberConfig = DISCORD_SUBSCRIBER_CONFIG
