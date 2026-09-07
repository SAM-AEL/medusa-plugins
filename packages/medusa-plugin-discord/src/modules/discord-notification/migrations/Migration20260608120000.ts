import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260608120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "discord_webhook_mapping" add column if not exists "bot_name" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "discord_webhook_mapping" drop column if exists "bot_name";`);
  }

}
