-- Allow multiple conversations per agent+user (local terminal new/fork chat).
DROP INDEX IF EXISTS "agent_conversations_agent_id_user_id_key";

ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "parent_conversation_id" TEXT;
ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "agent_conversations_agent_id_user_id_idx" ON "agent_conversations"("agent_id", "user_id");

DO $$ BEGIN
  ALTER TABLE "agent_conversations"
    ADD CONSTRAINT "agent_conversations_parent_conversation_id_fkey"
    FOREIGN KEY ("parent_conversation_id") REFERENCES "agent_conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
