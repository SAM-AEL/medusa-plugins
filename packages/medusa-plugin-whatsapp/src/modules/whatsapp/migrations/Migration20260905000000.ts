import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905000000 extends Migration {

  override async up(): Promise<void> {
    // Composite lookup index for the per-event fan-out query.
    // NOTE: intentionally NOT unique — pre-existing duplicate rows would make
    // a unique index fail the deploy. New duplicates are blocked by API
    // validation; operators should dedupe legacy rows before adding uniqueness.
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_whatsapp_event_active" ON "whatsapp_event_mapping" ("event_name", "active") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_whatsapp_log_created" ON "whatsapp_message_log" ("created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_whatsapp_event_active";`);
    this.addSql(`DROP INDEX IF EXISTS "idx_whatsapp_log_created";`);
  }

}
