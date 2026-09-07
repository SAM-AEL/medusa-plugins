import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260303202037 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "whatsapp_config" ("id" text not null, "phone_number_id" text null, "access_token" text null, "api_version" text not null default 'v25.0', "default_language_code" text not null default 'en_US', "active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "whatsapp_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_config_deleted_at" ON "whatsapp_config" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "whatsapp_event_mapping" ("id" text not null, "event_name" text not null, "template_name" text not null, "language_code" text not null default 'en_US', "template_variables" jsonb not null default '{}', "recipient_type" text not null default 'billing_shipping', "recipient_phone" text null, "active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "whatsapp_event_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_event_mapping_deleted_at" ON "whatsapp_event_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "whatsapp_message_log" ("id" text not null, "event_name" text not null, "recipient_phone" text not null, "template_name" text not null, "status" text check ("status" in ('pending', 'sent', 'failed', 'delivered')) not null default 'pending', "wa_message_id" text null, "error_message" text null, "request_payload" jsonb not null default '{}', "response_payload" jsonb not null default '{}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "whatsapp_message_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_whatsapp_message_log_deleted_at" ON "whatsapp_message_log" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "whatsapp_config" cascade;`);

    this.addSql(`drop table if exists "whatsapp_event_mapping" cascade;`);

    this.addSql(`drop table if exists "whatsapp_message_log" cascade;`);
  }

}
