-- Connectors (Google OAuth) + org n8n integration settings

ALTER TABLE "Organization"
  ADD COLUMN "n8n_base_url" TEXT,
  ADD COLUMN "n8n_webhook_secret_enc" TEXT,
  ADD COLUMN "n8n_email_read_path" TEXT NOT NULL DEFAULT '/webhook/qlix-email-read',
  ADD COLUMN "n8n_email_send_path" TEXT NOT NULL DEFAULT '/webhook/qlix-email-send';

CREATE TABLE "connector_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "email_address" TEXT,
  "token_enc" TEXT NOT NULL,
  "token_expires_at" TIMESTAMP(3),
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "connector_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_accounts_org_id_provider_key" ON "connector_accounts"("org_id", "provider");
CREATE INDEX "connector_accounts_user_id_idx" ON "connector_accounts"("user_id");

ALTER TABLE "connector_accounts"
  ADD CONSTRAINT "connector_accounts_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connector_accounts"
  ADD CONSTRAINT "connector_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
