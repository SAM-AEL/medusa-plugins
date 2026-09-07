import { model } from "@medusajs/framework/utils"

const DiscordWebhookMapping = model.define("discord_webhook_mapping", {
    id: model.id().primaryKey(),
    event_name: model.text().index("IDX_discord_webhook_mapping_event_name"),
    webhook_url: model.text().index("idx_discord_mapping_webhook_url"),
    channel_name: model.text().nullable(),
    is_active: model.boolean().default(true),
    message_template: model.text().nullable(),
    bot_name: model.text().nullable(),
})

export default DiscordWebhookMapping
