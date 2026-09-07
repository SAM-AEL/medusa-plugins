import { z } from "zod"

export const PostAdminCreateMailerMappingSchema = z.object({
  event_name: z.string().min(1).max(100),
  template_name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  sender_index: z.number().int().min(1).max(5).optional(),
  subject: z.string().max(998).optional(),
  template_variables: z.record(z.unknown()).optional(),
  recipient_type: z.enum(["customer_email", "admin_email", "custom_email"]).optional(),
  recipient_email: z.string().email().nullable().optional(),
  active: z.boolean().optional(),
})

export type PostAdminCreateMailerMapping = z.infer<typeof PostAdminCreateMailerMappingSchema>

export const PostAdminUpdateMailerMappingSchema = z.object({
  template_name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  sender_index: z.number().int().min(1).max(5).optional(),
  subject: z.string().max(998).optional(),
  template_variables: z.record(z.unknown()).optional(),
  recipient_type: z.enum(["customer_email", "admin_email", "custom_email"]).optional(),
  recipient_email: z.string().email().nullable().optional(),
  active: z.boolean().optional(),
})

export type PostAdminUpdateMailerMapping = z.infer<typeof PostAdminUpdateMailerMappingSchema>

export const PostAdminSendManualEmailSchema = z.object({
  to: z.string().email(),
  template_name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  subject: z.string().max(998).optional(),
  sender_index: z.number().int().min(1).max(5).optional(),
  variables: z.record(z.unknown()).optional(),
})

export type PostAdminSendManualEmail = z.infer<typeof PostAdminSendManualEmailSchema>
