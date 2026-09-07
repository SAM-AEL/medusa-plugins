import { z } from "zod"

export const PostAdminWhatsappConfigSchema = z.object({
  phone_number_id: z.string().regex(/^\d+$/, "phone_number_id must be numeric"),
  business_account_id: z.string().min(1).max(100),
  access_token: z.string().min(1).max(1000).optional(),
  api_version: z.string().regex(/^v\d+\.\d+$/).optional(),
})

export type PostAdminWhatsappConfig = z.infer<typeof PostAdminWhatsappConfigSchema>

export const PostAdminCreateWhatsappMappingSchema = z.object({
  event_name: z.string().min(1).max(100),
  template_name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/),
  language_code: z.string().min(2).max(10),
  template_variables: z.record(z.unknown()).optional(),
  recipient_type: z.enum(["billing_shipping", "shipping_billing", "billing_only", "shipping_only", "custom_phone"]).optional(),
  recipient_phone: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

export type PostAdminCreateWhatsappMapping = z.infer<typeof PostAdminCreateWhatsappMappingSchema>

export const PostAdminUpdateWhatsappMappingSchema = z.object({
  template_name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/).optional(),
  language_code: z.string().min(2).max(10).optional(),
  template_variables: z.record(z.unknown()).optional(),
  recipient_type: z.enum(["billing_shipping", "shipping_billing", "billing_only", "shipping_only", "custom_phone"]).optional(),
  recipient_phone: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

export type PostAdminUpdateWhatsappMapping = z.infer<typeof PostAdminUpdateWhatsappMappingSchema>

export const PostAdminSendManualWhatsappSchema = z.object({
  phone_number: z.string().min(8).max(20),
  template_name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/),
  language_code: z.string().min(2).max(10),
  parameters: z.record(z.string()).optional(),
})

export type PostAdminSendManualWhatsapp = z.infer<typeof PostAdminSendManualWhatsappSchema>
