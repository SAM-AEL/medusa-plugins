import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DISCORD_NOTIFICATION_MODULE } from "../../../../modules/discord-notification"
import { ok, fail, parsePagination, toSafeMapping } from "../../../../shared/http"
import { normalizeWebhookUrl, isValidWebhookUrl, isSupportedDiscordEvent } from "../../../../shared/discord-fields"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE)
    const { limit, offset } = parsePagination(req.query as Record<string, unknown>)

    const [mappings, count] = await (discordSvc as any).listAndCountDiscordWebhookMappings(
        {},
        {
            take: limit,
            skip: offset,
            order: { created_at: "DESC" },
        }
    )

    return ok(res, { mappings: (mappings || []).map(toSafeMapping), count })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE)
    const body = req.body as Record<string, any>

    const { event_name, webhook_url, channel_name, is_active, message_template, bot_name } = body

    if (!event_name || !webhook_url) {
        return fail(res, 400, "INVALID_PAYLOAD", "event_name and webhook_url are required")
    }

    if (typeof event_name !== "string" || event_name.length > 100 || !isSupportedDiscordEvent(event_name)) {
        return fail(res, 400, "INVALID_EVENT", "event_name is not a supported Discord event")
    }

    const normalizedUrl = normalizeWebhookUrl(webhook_url)
    if (!isValidWebhookUrl(normalizedUrl)) {
        return fail(res, 400, "INVALID_WEBHOOK_URL", "webhook_url must be a valid Discord Webhook URL")
    }

    if (typeof message_template === "string" && message_template.length > 8000) {
        return fail(res, 400, "TEMPLATE_TOO_LARGE", "message_template must be 8000 chars or fewer")
    }
    if (typeof bot_name === "string" && bot_name.length > 80) {
        return fail(res, 400, "INVALID_BOT_NAME", "bot_name must be 80 chars or fewer")
    }
    if (typeof channel_name === "string" && channel_name.length > 100) {
        return fail(res, 400, "INVALID_CHANNEL", "channel_name must be 100 chars or fewer")
    }
    if (is_active !== undefined && !(typeof is_active === "boolean" || is_active === "true" || is_active === "false")) {
        return fail(res, 400, "INVALID_ACTIVE", "is_active must be a boolean")
    }
    if (is_active === true || is_active === "true") {
        return fail(res, 400, "VERIFY_REQUIRED", "Test the webhook successfully before enabling this mapping")
    }

    const mapping = await (discordSvc as any).createDiscordWebhookMappings({
        event_name,
        webhook_url: normalizedUrl,
        channel_name: channel_name || null,
        is_active: is_active === undefined ? false : is_active === true || is_active === "true",
        message_template: message_template || null,
        bot_name: bot_name || null,
    })

    return ok(res, { mapping: toSafeMapping(mapping) }, 201)
}
