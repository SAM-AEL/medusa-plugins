import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DISCORD_NOTIFICATION_MODULE } from "../../../../../modules/discord-notification"
import { ok, fail, toSafeMapping } from "../../../../../shared/http"
import { normalizeWebhookUrl, isValidWebhookUrl, isSupportedDiscordEvent } from "../../../../../shared/discord-fields"

function isNotFoundError(err: any): boolean {
    const msg = String(err?.message || "").toLowerCase()
    const type = String(err?.type || "").toLowerCase()
    return type.includes("not_found") || msg.includes("not found") || err?.name === "MedusaError" && msg.includes("not found")
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE)
    const { id } = req.params
    const body = req.body as Record<string, any>

    const { event_name, webhook_url, channel_name, is_active, message_template, bot_name } = body

    try {
        const existing = await (discordSvc as any).retrieveDiscordWebhookMapping(id)
        if (!existing) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }

        if (webhook_url !== undefined) {
            const normalizedUrl = normalizeWebhookUrl(webhook_url)
            if (!isValidWebhookUrl(normalizedUrl)) {
                return fail(res, 400, "INVALID_WEBHOOK_URL", "webhook_url must be a valid Discord Webhook URL")
            }
        }
        if (event_name !== undefined && (typeof event_name !== "string" || event_name.length > 100 || !isSupportedDiscordEvent(event_name))) {
            return fail(res, 400, "INVALID_EVENT", "event_name is not a supported Discord event")
        }
        if (message_template !== undefined && typeof message_template === "string" && message_template.length > 8000) {
            return fail(res, 400, "TEMPLATE_TOO_LARGE", "message_template must be 8000 chars or fewer")
        }
        if (bot_name !== undefined && typeof bot_name === "string" && bot_name.length > 80) {
            return fail(res, 400, "INVALID_BOT_NAME", "bot_name must be 80 chars or fewer")
        }
        if (is_active !== undefined && !(typeof is_active === "boolean" || is_active === "true" || is_active === "false")) {
            return fail(res, 400, "INVALID_ACTIVE", "is_active must be a boolean")
        }
        if (is_active === true || is_active === "true") {
            return fail(res, 400, "VERIFY_REQUIRED", "Test the webhook successfully before enabling this mapping")
        }
        if (channel_name !== undefined && typeof channel_name === "string" && channel_name.length > 100) {
            return fail(res, 400, "INVALID_CHANNEL", "channel_name must be 100 chars or fewer")
        }

        const updateData: Record<string, any> = {}
        if (event_name !== undefined) updateData.event_name = event_name
        if (webhook_url !== undefined) {
            updateData.webhook_url = normalizeWebhookUrl(webhook_url)
            updateData.is_active = false
        }
        if (channel_name !== undefined) updateData.channel_name = channel_name || null
        if (is_active !== undefined) updateData.is_active = is_active === true || is_active === "true"
        if (message_template !== undefined) updateData.message_template = message_template || null
        if (bot_name !== undefined) updateData.bot_name = bot_name || null

        const mapping = await (discordSvc as any).updateDiscordWebhookMappings({
            id,
            ...updateData,
        })

        return ok(res, { mapping: toSafeMapping(mapping) })
    } catch (err: any) {
        if (isNotFoundError(err)) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }
        console.error(`[discord] update mapping failed: ${err instanceof Error ? err.message : "unknown"}`)
        return fail(res, 500, "ERROR", "Failed to update webhook mapping")
    }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE)
    const { id } = req.params

    try {
        const existing = await (discordSvc as any).retrieveDiscordWebhookMapping(id)
        if (!existing) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }

        await (discordSvc as any).deleteDiscordWebhookMappings(id)

        return ok(res, { deleted: true, id })
    } catch (err: any) {
        if (isNotFoundError(err)) {
            return fail(res, 404, "NOT_FOUND", `Webhook mapping with ID ${id} not found`)
        }
        console.error(`[discord] delete mapping failed: ${err instanceof Error ? err.message : "unknown"}`)
        return fail(res, 500, "ERROR", "Failed to delete webhook mapping")
    }
}
