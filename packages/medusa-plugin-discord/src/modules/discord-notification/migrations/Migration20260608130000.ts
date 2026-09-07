import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260608130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "discord_plugin_setting" ("id" text not null, "avatar_url" text null, "footer_text" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discord_plugin_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discord_plugin_setting_deleted_at" ON "discord_plugin_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "discord_plugin_setting" cascade;`);
  }

}
