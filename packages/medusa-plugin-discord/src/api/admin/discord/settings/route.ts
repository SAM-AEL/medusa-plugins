import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DISCORD_NOTIFICATION_MODULE } from "../../../../modules/discord-notification"
import { ok, fail } from "../../../../shared/http"

function isValidAvatarUrl(url: string | null | undefined): boolean {
    if (!url) {
        return true
    }
    if (url.length > 2048) {
        return false
    }
    try {
        const parsed = new URL(url)
        return parsed.protocol === "https:"
    } catch {
        return false
    }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE) as any

    try {
        const settings = await discordSvc.getSettings()
        return ok(res, { settings })
    } catch (error) {
        console.error(`[discord] get settings failed: ${error instanceof Error ? error.message : "unknown"}`)
        return fail(res, 500, "ERROR", "Internal server error")
    }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const discordSvc = req.scope.resolve(DISCORD_NOTIFICATION_MODULE) as any
    const body = req.body as { avatar_url?: string; footer_text?: string }

    if (!isValidAvatarUrl(body.avatar_url)) {
        return fail(res, 400, "INVALID_AVATAR_URL", "avatar_url must be a valid https URL up to 2048 chars")
    }
    if (typeof body.footer_text === "string" && body.footer_text.length > 2048) {
        return fail(res, 400, "INVALID_FOOTER", "footer_text must be 2048 chars or fewer")
    }

    try {
        await discordSvc.upsertSettings({
            avatar_url: body.avatar_url || null,
            footer_text: body.footer_text || null,
        })
        const settings = await discordSvc.getSettings()
        return ok(res, { settings })
    } catch (error) {
        console.error(`[discord] upsert settings failed: ${error instanceof Error ? error.message : "unknown"}`)
        return fail(res, 500, "ERROR", "Internal server error")
    }
}
