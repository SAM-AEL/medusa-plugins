import { MedusaService } from "@medusajs/framework/utils"
import DiscordWebhookMapping from "./models/discord_webhook_mapping"
import DiscordOrderMessage from "./models/discord_order_message"
import { DiscordPluginSetting } from "./models/discord_plugin_setting"

export type DiscordNotificationOptions = {
    /** Global fallback bot name shown in Discord when no per-mapping bot_name is set.
     *  Defaults to "Discord Bot". Can be set via DISCORD_DEFAULT_BOT_NAME env var. */
    defaultBotName?: string
}

class DiscordNotificationModuleService extends MedusaService({
    DiscordWebhookMapping,
    DiscordOrderMessage,
    DiscordPluginSetting,
}) {
    private options_: DiscordNotificationOptions

    constructor(container: any, options?: DiscordNotificationOptions) {
        super(...arguments as any)
        this.options_ = options || {}
    }

    getDefaultBotName(): string {
        return this.options_.defaultBotName || "Discord Bot"
    }

    async getSettings(): Promise<{ avatar_url?: string; footer_text?: string }> {
        const settings = await this.listDiscordPluginSettings({})
        if (settings && settings.length > 0) {
            return {
                avatar_url: settings[0].avatar_url ?? undefined,
                footer_text: settings[0].footer_text ?? undefined,
            }
        }
        return {}
    }

    async upsertSettings(data: { avatar_url?: string | null; footer_text?: string | null }): Promise<void> {
        const settings = await this.listDiscordPluginSettings({})
        if (settings && settings.length > 0) {
            await this.updateDiscordPluginSettings({
                id: settings[0].id,
                ...data,
            })
        } else {
            await this.createDiscordPluginSettings({
                ...data,
            })
        }
    }
}

export default DiscordNotificationModuleService
