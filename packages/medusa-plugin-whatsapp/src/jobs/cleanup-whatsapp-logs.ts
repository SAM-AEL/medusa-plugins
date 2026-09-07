import type { MedusaContainer } from "@medusajs/framework/types"

const WHATSAPP_MODULE = "whatsapp"

export default async function cleanupWhatsappLogsJob(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const whatsappModule = container.resolve(WHATSAPP_MODULE)
  const rawRetention = Number(process.env.WHATSAPP_LOG_RETENTION_DAYS ?? 30)
  const retentionDays = Number.isFinite(rawRetention)
    ? Math.min(Math.max(Math.floor(rawRetention), 1), 365)
    : 30
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  try {
    let totalDeleted = 0
    for (let page = 0; page < 20; page++) {
      const [logs] = await (whatsappModule as any).listAndCountWhatsappMessageLogs(
        { created_at: { $lt: cutoff } },
        { take: 500, order: { created_at: "ASC" } }
      )

      if (!logs?.length) {
        break
      }

      await (whatsappModule as any).deleteWhatsappMessageLogs(logs.map((entry: { id: string }) => entry.id))
      totalDeleted += logs.length
      if (logs.length < 500) {
        break
      }
    }
    if (totalDeleted > 0) {
      logger.info(`[WhatsApp] Cleanup job deleted ${totalDeleted} log records older than ${retentionDays} days`)
    }
  } catch (error: any) {
    logger.error(`[WhatsApp] Cleanup job failed: ${error instanceof Error ? error.message : "unknown"}`)
  }
}

export const config = {
  name: "cleanup-whatsapp-logs",
  schedule: "0 3 * * *",
}
