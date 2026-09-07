import { model } from "@medusajs/framework/utils"

const WhatsappEventMapping = model.define("whatsapp_event_mapping", {
    id: model.id().primaryKey(),
    event_name: model.text().index("IDX_whatsapp_event_mapping_event_name"),
    template_name: model.text(),
    language_code: model.text().default("en_US"),
    template_variables: model.json().default({}),
    recipient_type: model.text().default("billing_shipping"),
    recipient_phone: model.text().nullable(),
    active: model.boolean().default(true).index("IDX_whatsapp_event_mapping_active"),
}).indexes([
    {
        on: ["event_name", "active"],
        name: "idx_whatsapp_event_active",
    },
])

export default WhatsappEventMapping
