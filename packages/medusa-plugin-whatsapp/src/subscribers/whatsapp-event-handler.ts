import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { WHATSAPP_EVENTS } from "../shared/whatsapp-fields"
import { sendEventWhatsappWorkflow } from "../workflows"

export default async function whatsappEventHandler({
    event: { name, data },
    container,
}: SubscriberArgs<Record<string, any>>) {
    const logger = container.resolve("logger")

    try {
        await sendEventWhatsappWorkflow(container).run({
            input: {
                event_name: name,
                event_data: data,
            },
        })
    } catch (error: any) {
        logger.error(`[WhatsApp] Subscriber workflow error: ${error.message}`)
    }
}

export const config: SubscriberConfig = {
    event: WHATSAPP_EVENTS,
}
