import { model } from "@medusajs/framework/utils"

const DiscordOrderMessage = model.define("discord_order_message", {
    id: model.id().primaryKey(),
    order_id: model.text().index("IDX_discord_order_message_order_id"),
    webhook_url: model.text().index("idx_discord_order_msg_webhook_url"),
    message_id: model.text(),
}).indexes([
    {
        on: ["order_id", "webhook_url"],
        name: "idx_discord_order_msg_lookup",
    },
])

export default DiscordOrderMessage
