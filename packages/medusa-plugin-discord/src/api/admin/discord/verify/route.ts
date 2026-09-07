import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DISCORD_NOTIFICATION_MODULE } from "../../../../modules/discord-notification"
import { ok, fail } from "../../../../shared/http"

function getNestedValue(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

function formatValue(value: any, path: string): string {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "number") {
        if (
            path === "total" ||
            path === "subtotal" ||
            path.endsWith(".total") ||
            path.endsWith(".subtotal") ||
            path.endsWith(".price") ||
            path.endsWith(".unit_price")
        ) {
            return (value / 100).toFixed(2);
        }
        return value.toString();
    }
    if (Array.isArray(value)) {
        if (path === "items" || path.endsWith(".items")) {
            return value.map((item: any) => {
                if (typeof item === "object" && item !== null) {
                    const title = item.title || item.name || "Item";
                    const qty = item.quantity !== undefined ? ` (Qty: ${item.quantity})` : "";
                    const price = item.unit_price !== undefined ? ` - $${(item.unit_price / 100).toFixed(2)}` : "";
                    return `- ${title}${qty}${price}`;
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
        let formatted = formatValue(value, path);
        if (isJson && typeof formatted === "string") {
            formatted = formatted.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
        }
        return formatted;
    });
}

const mockOrder = {
    id: "order_01H2X3Y4Z5W6V7U8T9S0R1Q2P3",
    display_id: 1234,
    status: "pending",
    email: "customer@example.com",
    currency_code: "usd",
    total: 12550,
    subtotal: 10000,
    shipping_address: {
        first_name: "Jane",
        last_name: "Doe",
        phone: "+15551234567",
        city: "New York"
    },
    billing_address: {
        first_name: "Jane",
        last_name: "Doe",
        phone: "+15551234567"
    },
    customer: {
        first_name: "Jane",
        last_name: "Doe",
        email: "customer@example.com",
        phone: "+15551234567"
    },
    items: [
        { title: "Premium Graphic Tee", quantity: 2, unit_price: 5000 },
        { title: "Sticker Pack", quantity: 1, unit_price: 2550 }
    ]
}

const mockCustomer = {
    id: "cus_01H2X3Y4Z5W6V7U8T9S0R1Q2P3",
    email: "newuser@example.com",
    first_name: "John",
    last_name: "Smith",
    phone: "+15559876543"
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE) as any
    const body = req.body as Record<string, any>
    const id = body.id || (req.query.id as string)

    if (!id) {
        return fail(res, 400, "INVALID_PAYLOAD", "Mapping ID is required")
    }

    try {
        const mapping = await (discordSvc as any).retrieveDiscordWebhookMapping(id)
        if (!mapping) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }

        const globalSettings = await discordSvc.getSettings()

        let payload: any = null

        if (mapping.message_template) {
            const mockData = mapping.event_name === "customer.created" || mapping.event_name === "customer.updated" ? mockCustomer : mockOrder
            const content = compileTemplate(mapping.message_template, mockData)
            try {
                const parsedJson = JSON.parse(content)
                const { username: _u, avatar_url: _a, allowed_mentions: _m, tts: _t, ...safe } = parsedJson || {}
                payload = {
                    username: mapping.bot_name || discordSvc.getDefaultBotName(),
                    ...(globalSettings.avatar_url ? { avatar_url: globalSettings.avatar_url } : {}),
                    allowed_mentions: { parse: [] },
                    ...(typeof safe.content === "string" ? { content: safe.content.slice(0, 2000) } : {}),
                    ...(Array.isArray(safe.embeds) ? { embeds: safe.embeds.slice(0, 10) } : {}),
                }
            } catch (e) {
                payload = {
                    username: mapping.bot_name || discordSvc.getDefaultBotName(),
                    ...(globalSettings.avatar_url ? { avatar_url: globalSettings.avatar_url } : {}),
                    allowed_mentions: { parse: [] },
                    content: content.slice(0, 2000)
                }
            }
        } else {
            payload = {
                username: mapping.bot_name || discordSvc.getDefaultBotName(),
                allowed_mentions: { parse: [] },
                embeds: [
                    {
                        title: "🔔 Connection Test",
                        description: `This is a test notification verifying that **${mapping.event_name}** mappings route correctly to this Discord channel!`,
                        color: 3066993, // Green
                        fields: [
                            { name: "Channel Label", value: mapping.channel_name || "None", inline: true },
                            { name: "Event Name", value: mapping.event_name, inline: true },
                            { name: "Status", value: mapping.is_active ? "🟢 Active" : "🔴 Inactive", inline: true }
                        ],
                        timestamp: new Date().toISOString(),
                        footer: { text: "Medusa Storefront Integration" }
                    }
                ]
            }
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        let response: Response
        try {
            response = await fetch(mapping.webhook_url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timer)
        }

        if (!response.ok) {
            const errText = (await response.text()).slice(0, 300)
            return fail(res, 400, "WEBHOOK_FAILED", `Discord webhook returned status ${response.status}: ${errText}`)
        }

        return ok(res, { success: true })
    } catch (err: any) {
        const msg = String(err?.name === "AbortError" ? "Discord webhook timed out" : err?.message || "Failed to trigger test ping").slice(0, 300)
        if (String(err?.message || "").toLowerCase().includes("not found")) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }
        return fail(res, 500, "ERROR", msg)
    }
}
