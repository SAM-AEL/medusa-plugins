import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { fail, ok } from "../../../../shared/http"

const WHATSAPP_MODULE = "whatsapp"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)

    const [configs] = await (whatsappModule as any).listAndCountWhatsappConfigs(
        {},
        { take: 1 }
    )

    const envHints = {
        env_phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
        env_configured: !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN),
    }

    if (configs.length === 0) {
        return ok(res, {
            config: null,
            ...envHints,
        })
    }

    const config = configs[0]

    return ok(res, { config, ...envHints })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const whatsappModule = req.scope.resolve(WHATSAPP_MODULE)
    const body = req.body as Record<string, any>

    if ("access_token" in body) {
        return fail(
            res,
            400,
            "INVALID_PAYLOAD",
            "access_token must not be sent in API payload. Use WHATSAPP_ACCESS_TOKEN env secret."
        )
    }

    const { phone_number_id, api_version, default_language_code, active } = body

    if (phone_number_id !== undefined && (typeof phone_number_id !== "string" || !/^\d+$/.test(phone_number_id))) {
        return fail(res, 400, "INVALID_PHONE_NUMBER_ID", "phone_number_id must be a numeric Meta phone number ID")
    }
    if (api_version !== undefined && (typeof api_version !== "string" || !/^v\d+\.\d+$/.test(api_version))) {
        return fail(res, 400, "INVALID_API_VERSION", "api_version must look like v25.0")
    }
    if (default_language_code !== undefined && (typeof default_language_code !== "string" || default_language_code.length > 16)) {
        return fail(res, 400, "INVALID_LANGUAGE", "default_language_code is invalid")
    }

    // Check if a config already exists
    const [existing] = await (whatsappModule as any).listAndCountWhatsappConfigs(
        {},
        { take: 1 }
    )

    const coerceActive = (v: unknown, fallback: boolean) =>
        v === undefined ? fallback : v === true || v === "true"

    let config
    if (existing.length > 0) {
        // Update existing config
        const updateData: Record<string, any> = {}
        if (phone_number_id !== undefined) updateData.phone_number_id = phone_number_id

        if (api_version !== undefined) updateData.api_version = api_version
        if (default_language_code !== undefined) updateData.default_language_code = default_language_code
        if (active !== undefined) updateData.active = coerceActive(active, true)

        config = await (whatsappModule as any).updateWhatsappConfigs(existing[0].id, updateData)
    } else {
        // Create new config
        config = await (whatsappModule as any).createWhatsappConfigs({
            phone_number_id: phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
            api_version: api_version || process.env.WHATSAPP_API_VERSION || "v25.0",
            default_language_code: default_language_code || "en_US",
            active: coerceActive(active, true),
        })
    }
    return ok(res, { config })
}
