import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260408090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "whatsapp_config" drop column if exists "access_token";`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_event_mapping_event_name" ON "whatsapp_event_mapping" ("event_name") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_event_mapping_recipient_phone" ON "whatsapp_event_mapping" ("recipient_phone") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_message_log_event_name" ON "whatsapp_message_log" ("event_name") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_message_log_recipient_phone" ON "whatsapp_message_log" ("recipient_phone") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_message_log_status" ON "whatsapp_message_log" ("status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_message_log_created_at" ON "whatsapp_message_log" ("created_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "whatsapp_config" add column if not exists "access_token" text null;`)

    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_event_mapping_event_name";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_event_mapping_recipient_phone";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_message_log_event_name";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_message_log_recipient_phone";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_message_log_status";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_whatsapp_message_log_created_at";`)
  }
}
