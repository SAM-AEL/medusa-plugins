import { model } from "@medusajs/framework/utils"

export const DiscordPluginSetting = model.define("discord_plugin_setting", {
    id: model.id().primaryKey(),
    avatar_url: model.text().nullable(),
    footer_text: model.text().nullable(),
})
