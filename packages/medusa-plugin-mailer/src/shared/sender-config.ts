import { sanitizeEmailAddress, sanitizeSenderName } from "./mailer-runtime"

export interface SenderOptions {
    fromEmail?: string
    fromName?: string
}

export function resolveNotificationSender(
    options: SenderOptions,
    env: NodeJS.ProcessEnv = process.env
): { fromAddress: string; fromName: string } {
    return {
        fromAddress: sanitizeEmailAddress(
            options.fromEmail || env.MAILER_FROM_ADDRESS_1 || env.MAILER_SENDER_1_EMAIL || env.MAILER_SMTP_USER || ""
        ),
        fromName: sanitizeSenderName(
            options.fromName || env.MAILER_FROM_NAME_1 || env.MAILER_SENDER_1_NAME || "Store"
        ),
    }
}
