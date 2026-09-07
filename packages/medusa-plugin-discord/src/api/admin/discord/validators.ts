import { z } from "zod"

export const PostAdminDiscordSettingsSchema = z.object({
  avatar_url: z.string().url().max(2048).nullable().optional(),
  footer_text: z.string().max(2048).nullable().optional(),
})

export type PostAdminDiscordSettings = z.infer<typeof PostAdminDiscordSettingsSchema>

export const PostAdminCreateDiscordMappingSchema = z.object({
  event_name: z.string().min(1).max(100),
  webhook_url: z.string().url().max(500).regex(/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/),
  channel_name: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  message_template: z.string().max(8000).nullable().optional(),
  bot_name: z.string().max(80).nullable().optional(),
})

export type PostAdminCreateDiscordMapping = z.infer<typeof PostAdminCreateDiscordMappingSchema>

export const PostAdminUpdateDiscordMappingSchema = z.object({
  webhook_url: z.string().url().max(500).regex(/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/).optional(),
  channel_name: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  message_template: z.string().max(8000).nullable().optional(),
  bot_name: z.string().max(80).nullable().optional(),
})

export type PostAdminUpdateDiscordMapping = z.infer<typeof PostAdminUpdateDiscordMappingSchema>
