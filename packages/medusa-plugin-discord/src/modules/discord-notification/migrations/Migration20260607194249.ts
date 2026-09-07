import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260607194249 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "discord_webhook_mapping" ("id" text not null, "event_name" text not null, "webhook_url" text not null, "channel_name" text null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discord_webhook_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discord_webhook_mapping_event_name" ON "discord_webhook_mapping" ("event_name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discord_webhook_mapping_deleted_at" ON "discord_webhook_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "discord_webhook_mapping" cascade;`);
  }

}
