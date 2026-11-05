import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"
import { createTransporter, buildRenderedMessage, sanitizeEmailAddress } from "../../shared/mailer-runtime"
import { isValidEmail } from "../../shared/http"
import { resolveNotificationSender } from "../../shared/sender-config.js"

export { resolveNotificationSender } from "../../shared/sender-config.js"

export interface MailerNotificationOptions {
    fromEmail?: string
    fromName?: string
    channels?: string[]
}

/**
 * MailerNotificationProviderService
 * 
 * First-class Medusa v2 Notification Module Provider implementation.
 * Enables store operators to use @sam-ael/medusa-plugin-mailer as an official
 * email provider under Medusa's Notification Module (`@medusajs/medusa/notification`).
 */
export class MailerNotificationProviderService extends AbstractNotificationProviderService {
    static identifier = "mailer-notification"
    protected options_: MailerNotificationOptions

    constructor(_container: Record<string, unknown>, options?: MailerNotificationOptions) {
        super()
        this.options_ = options || {}
    }

    async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
        if (!notification.to) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Notification recipient ('to') is required")
        }

        const transporter = createTransporter()
        if (!transporter) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "SMTP transport is not configured")
        }

        const templateName = notification.template || "generic_notification"
        const variables = (notification.data || {}) as Record<string, unknown>
        const subject = typeof variables.subject === "string" && variables.subject.trim()
            ? variables.subject.trim()
            : "Notification"

        const rendered = buildRenderedMessage({
            templateName,
            subject,
            variables,
            recipientEmail: notification.to,
        })

        if (!rendered) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, `Template '${templateName}' could not be loaded`)
        }

        const cleanTo = sanitizeEmailAddress(notification.to)
        if (!isValidEmail(cleanTo)) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Notification recipient ('to') must be a valid email address")
        }
        const { fromAddress, fromName } = resolveNotificationSender(this.options_)
        if (!isValidEmail(fromAddress)) {
            throw new MedusaError(MedusaError.Types.INVALID_DATA, "Sender address is misconfigured")
        }

        const result = await transporter.sendMail({
            from: { name: fromName, address: fromAddress },
            to: cleanTo,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
        })

        return {
            // ProviderSendNotificationResultsDTO only accepts an optional `id`.
            // Returning `to`/`status`/`data` was a type error, and the message id
            // is the only value the notification module can meaningfully store.
            id: result.messageId,
        }
    }
}

export default MailerNotificationProviderService
