-- Pending agent/team plans proposed by the org AI brain (exa); create only after user confirm.
CREATE TABLE "brain_agent_proposals" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "brain_agent_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "plan_json" JSONB NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "primary_agent_id" TEXT,
    "created_agent_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "team_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "brain_agent_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brain_agent_proposals_org_id_status_idx" ON "brain_agent_proposals"("org_id", "status");
CREATE INDEX "brain_agent_proposals_conversation_id_idx" ON "brain_agent_proposals"("conversation_id");
CREATE INDEX "brain_agent_proposals_brain_agent_id_idx" ON "brain_agent_proposals"("brain_agent_id");

ALTER TABLE "brain_agent_proposals" ADD CONSTRAINT "brain_agent_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_agent_proposals" ADD CONSTRAINT "brain_agent_proposals_brain_agent_id_fkey" FOREIGN KEY ("brain_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_agent_proposals" ADD CONSTRAINT "brain_agent_proposals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_agent_proposals" ADD CONSTRAINT "brain_agent_proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "brain_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
