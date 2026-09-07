import { model } from "@medusajs/framework/utils"

const WhatsappConfig = model.define("whatsapp_config", {
    id: model.id().primaryKey(),
    phone_number_id: model.text().nullable(),
    api_version: model.text().default("v25.0"),
    default_language_code: model.text().default("en_US"),
    active: model.boolean().default(true),
})

export default WhatsappConfig
