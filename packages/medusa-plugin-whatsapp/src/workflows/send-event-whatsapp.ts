import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
    sendEventWhatsappStep,
    type SendEventWhatsappStepInput,
} from "./steps/send-event-whatsapp"

export const sendEventWhatsappWorkflow = createWorkflow(
    "send-event-whatsapp",
    (input: SendEventWhatsappStepInput) => {
        const result = sendEventWhatsappStep(input)

        return new WorkflowResponse(result)
    }
)
