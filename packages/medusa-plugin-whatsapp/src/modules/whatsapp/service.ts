import { MedusaService } from "@medusajs/framework/utils"
import WhatsappConfig from "./models/whatsapp_config"
import WhatsappEventMapping from "./models/whatsapp_event_mapping"
import WhatsappMessageLog from "./models/whatsapp_message_log"

class WhatsappModuleService extends MedusaService({
    WhatsappConfig,
    WhatsappEventMapping,
    WhatsappMessageLog,
}) { }

export default WhatsappModuleService
