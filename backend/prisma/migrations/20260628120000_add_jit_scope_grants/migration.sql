-- Conversation-scoped JIT approval grants ("approve once per session").

CREATE TABLE "jit_scope_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "granted_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "jit_scope_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "jit_scope_grants_conversation_id_scope_key" ON "jit_scope_grants"("conversation_id", "scope");
CREATE INDEX "jit_scope_grants_conversation_id_idx" ON "jit_scope_grants"("conversation_id");
CREATE INDEX "jit_scope_grants_agent_id_idx" ON "jit_scope_grants"("agent_id");

ALTER TABLE "jit_scope_grants"
  ADD CONSTRAINT "jit_scope_grants_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
