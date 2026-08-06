CREATE TABLE "brain_conversations" (
  "id" TEXT NOT NULL,
  "brain_agent_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL DEFAULT 'New chat',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brain_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brain_conversation_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "citations" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brain_conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brain_conversations_user_id_org_id_updated_at_idx"
  ON "brain_conversations"("user_id", "org_id", "updated_at");
CREATE INDEX "brain_conversations_brain_agent_id_idx" ON "brain_conversations"("brain_agent_id");
CREATE INDEX "brain_conversation_messages_conversation_id_created_at_idx"
  ON "brain_conversation_messages"("conversation_id", "created_at");

ALTER TABLE "brain_conversations"
  ADD CONSTRAINT "brain_conversations_brain_agent_id_fkey"
  FOREIGN KEY ("brain_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_conversations"
  ADD CONSTRAINT "brain_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_conversations"
  ADD CONSTRAINT "brain_conversations_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_conversation_messages"
  ADD CONSTRAINT "brain_conversation_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "brain_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
