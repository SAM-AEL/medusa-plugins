import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getWhatsappConfig } from "../../../../shared/whatsapp-runtime"
import { fail, ok } from "../../../../shared/http"

const WHATSAPP_MODULE = "whatsapp"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)

    // Get config for credentials
    const [configs] = await (whatsappModule as any).listAndCountWhatsappConfigs(
        {},
        { take: 1 }
    )

    const whatsappConfig = await getWhatsappConfig(whatsappModule)
    const accessToken = whatsappConfig.accessToken
    const apiVersion = whatsappConfig.apiVersion
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID

    if (!accessToken || !wabaId) {
        return ok(res, {
            templates: [],
            message: !wabaId
                ? "Set WHATSAPP_BUSINESS_ACCOUNT_ID env var to fetch templates."
                : "WhatsApp access token not configured.",
        })
    }

    try {
        const url = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?limit=100&status=APPROVED`

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        let response: Response
        try {
            response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timer)
        }

        let data: any = null
        try {
            data = await response.json()
        } catch {
            return fail(res, 502, "TEMPLATE_FETCH_FAILED", "Template provider returned non-JSON response", {
                templates: [],
            })
        }

        if (!response.ok) {
            return fail(res, 400, "TEMPLATE_FETCH_FAILED", data?.error?.message || "Failed to fetch templates", {
                templates: [],
            })
        }

        // Return simplified template list
        const templates = (data.data || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            language: t.language,
            status: t.status,
            category: t.category,
            components: t.components,
        }))

        return ok(res, { templates })
    } catch (error: any) {
        return fail(res, 500, "TEMPLATE_FETCH_FAILED", "Failed to fetch templates", { templates: [] })
    }
}
