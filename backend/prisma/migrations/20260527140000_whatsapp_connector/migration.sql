-- AlterTable
ALTER TABLE "connector_accounts" ADD COLUMN IF NOT EXISTS "whatsapp_owner_jid" TEXT;
ALTER TABLE "connector_accounts" ADD COLUMN IF NOT EXISTS "whatsapp_default_agent_id" TEXT;
