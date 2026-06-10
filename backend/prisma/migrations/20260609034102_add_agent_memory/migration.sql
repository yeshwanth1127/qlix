-- CreateTable
CREATE TABLE "agent_memories" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_memories_agent_id_user_id_kind_created_at_idx" ON "agent_memories"("agent_id", "user_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
