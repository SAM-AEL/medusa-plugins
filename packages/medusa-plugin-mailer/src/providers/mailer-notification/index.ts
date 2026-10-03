import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"
import {
    createTransporter,
    buildRenderedMessage,
    sanitizeSenderName,
    sanitizeEmailAddress,
} from "../../shared/mailer-runtime"

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

        const fromAddress = sanitizeEmailAddress(
            this.options_.fromEmail ||
            process.env.MAILER_SENDER_1_EMAIL ||
            process.env.MAILER_SMTP_USER ||
            ""
        )
        const fromName = sanitizeSenderName(
            this.options_.fromName ||
            process.env.MAILER_SENDER_1_NAME ||
            "Store"
        )

        const result = await transporter.sendMail({
            from: { name: fromName, address: fromAddress },
            to: notification.to,
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
