import { model } from "@medusajs/framework/utils"

const WhatsappMessageLog = model.define("whatsapp_message_log", {
    id: model.id().primaryKey(),
    event_name: model.text().index("IDX_whatsapp_message_log_event_name"),
    recipient_phone: model.text().index("IDX_whatsapp_message_log_recipient_phone"),
    template_name: model.text(),
    status: model.enum(["pending", "sent", "failed", "delivered"]).default("pending").index("IDX_whatsapp_message_log_status"),
    wa_message_id: model.text().nullable(),
    error_message: model.text().nullable(),
    request_payload: model.json().default({}),
    response_payload: model.json().default({}),
}).indexes([
    {
        on: ["created_at"],
        name: "idx_whatsapp_log_created",
    },
])

export default WhatsappMessageLog
