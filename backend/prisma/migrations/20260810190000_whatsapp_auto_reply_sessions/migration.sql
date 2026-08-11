-- WhatsApp auto-reply sessions + AgentRun reply-to contact JID
CREATE TABLE IF NOT EXISTS "whatsapp_auto_reply_sessions" (
    "id" TEXT NOT NULL,
    "connector_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "contact_jid" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_outbound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_auto_reply_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_auto_reply_sessions_connector_id_contact_jid_key"
  ON "whatsapp_auto_reply_sessions"("connector_id", "contact_jid");

CREATE INDEX IF NOT EXISTS "whatsapp_auto_reply_sessions_connector_id_status_expires_at_idx"
  ON "whatsapp_auto_reply_sessions"("connector_id", "status", "expires_at");

CREATE INDEX IF NOT EXISTS "whatsapp_auto_reply_sessions_agent_id_status_idx"
  ON "whatsapp_auto_reply_sessions"("agent_id", "status");

ALTER TABLE "whatsapp_auto_reply_sessions"
  ADD CONSTRAINT "whatsapp_auto_reply_sessions_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "whatsapp_reply_to_jid" TEXT;
