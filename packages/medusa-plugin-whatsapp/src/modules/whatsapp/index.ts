import { Module } from "@medusajs/framework/utils"
import WhatsappModuleService from "./service"

export const WHATSAPP_MODULE = "whatsapp"

export default Module(WHATSAPP_MODULE, {
    service: WhatsappModuleService,
})
