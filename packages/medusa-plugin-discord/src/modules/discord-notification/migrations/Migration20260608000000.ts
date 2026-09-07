import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260608000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "discord_order_message" ("id" text not null, "order_id" text not null, "webhook_url" text not null, "message_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discord_order_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discord_order_message_order_id" ON "discord_order_message" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discord_order_message_deleted_at" ON "discord_order_message" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "discord_order_message" cascade;`);
  }

}
