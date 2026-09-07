import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905000000 extends Migration {

  override async up(): Promise<void> {
    // NOTE: intentionally NOT unique — duplicate (order_id, webhook_url) rows
    // already exist in the wild (see audit B10) and a unique index would fail
    // the deploy. Operators should dedupe legacy rows, then promote
    // idx_discord_order_msg_lookup to UNIQUE WHERE deleted_at IS NULL.
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_discord_order_msg_lookup" ON "discord_order_message" ("order_id", "webhook_url") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_discord_order_msg_webhook_url" ON "discord_order_message" ("webhook_url") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_discord_mapping_webhook_url" ON "discord_webhook_mapping" ("webhook_url") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "idx_discord_order_msg_lookup";`);
    this.addSql(`DROP INDEX IF EXISTS "idx_discord_order_msg_webhook_url";`);
    this.addSql(`DROP INDEX IF EXISTS "idx_discord_mapping_webhook_url";`);
  }

}
