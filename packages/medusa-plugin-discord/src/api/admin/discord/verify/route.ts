import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DISCORD_NOTIFICATION_MODULE } from "../../../../modules/discord-notification"
import { ok, fail, RateLimiter, getActorId } from "../../../../shared/http"
import { discordEscape } from "../../../../shared/discord-fields"

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

function sanitizeEmbedFields(embeds: any[]): any[] {
    return embeds.slice(0, 10).map((e: any) => {
        if (!e || typeof e !== "object") return e
        const out: any = { ...e }
        if (typeof out.title === "string") out.title = out.title.slice(0, 256)
        if (typeof out.description === "string") out.description = out.description.slice(0, 4096)
        if (Array.isArray(out.fields)) {
            out.fields = out.fields.slice(0, 25).map((f: any) => ({
                ...f,
                name: typeof f?.name === "string" ? f.name.slice(0, 256) : f?.name,
                value: typeof f?.value === "string" ? f.value.slice(0, 1024) : f?.value,
            }))
        }
        if (out.footer && typeof out.footer.text === "string") out.footer = { ...out.footer, text: out.footer.text.slice(0, 2048) }
        return out
    })
}

function compileTemplate(template: string, data: any): string {
    const isJson = template.trim().startsWith("{") && template.trim().endsWith("}");
    return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, path) => {
        const value = getNestedValue(data, path);
        let formatted = discordEscape(formatValue(value, path));
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
    currency_code: "usd",
    total: 12550,
    subtotal: 10000,
    shipping_address: {
        city: "Example City"
    },
    billing_address: {},
    customer: {},
    items: [
        { title: "Premium Graphic Tee", quantity: 2, unit_price: 5000 },
        { title: "Sticker Pack", quantity: 1, unit_price: 2550 }
    ]
}

const mockCustomer = {
    id: "cus_example_123"
}

const verifyRateLimiter = new RateLimiter(5, 60 * 1000)

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE) as any
    const body = req.body as Record<string, any>
    const id = body.id || (req.query.id as string)

    if (!id || typeof id !== "string") {
        return fail(res, 400, "INVALID_PAYLOAD", "Mapping ID is required")
    }

    if (!verifyRateLimiter.isAllowed(`${getActorId(req)}:${id}`)) {
        return fail(res, 429, "RATE_LIMITED", "Too many test pings for this mapping. Try again in a minute.")
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
                    username: (mapping.bot_name || discordSvc.getDefaultBotName()).slice(0, 80),
                    ...(globalSettings.avatar_url ? { avatar_url: globalSettings.avatar_url } : {}),
                    allowed_mentions: { parse: [] },
                    ...(typeof safe.content === "string" ? { content: safe.content.slice(0, 2000) } : {}),
                    ...(Array.isArray(safe.embeds) ? { embeds: sanitizeEmbedFields(safe.embeds) } : {}),
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
                        footer: { text: "Your Store" }
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

        if (response.status === 429) {
            return fail(res, 429, "RATE_LIMITED", "Discord rate-limited the test ping. Try again shortly.")
        }

        if (!response.ok) {
            return fail(res, 400, "WEBHOOK_FAILED", `Discord rejected the test ping (status ${response.status})`)
        }

        await discordSvc.updateDiscordWebhookMappings({ id, is_active: true })
        return ok(res, { success: true })
    } catch (err: any) {
        const msg = String(err?.name === "AbortError" ? "Discord webhook timed out" : err?.message || "Failed to trigger test ping").slice(0, 300)
        if (String(err?.message || "").toLowerCase().includes("not found")) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }
        return fail(res, 500, "ERROR", msg)
    }
}
