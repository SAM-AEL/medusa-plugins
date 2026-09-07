import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260607201634 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "discord_webhook_mapping" add column if not exists "message_template" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "discord_webhook_mapping" drop column if exists "message_template";`);
  }

}
