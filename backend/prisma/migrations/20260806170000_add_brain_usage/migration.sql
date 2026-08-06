CREATE TABLE "brain_usages" (
    "id" TEXT NOT NULL,
    "brain_agent_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "model" TEXT,
    "provider" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_usages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brain_usages_brain_agent_id_created_at_idx" ON "brain_usages"("brain_agent_id", "created_at");
CREATE INDEX "brain_usages_org_id_created_at_idx" ON "brain_usages"("org_id", "created_at");
CREATE INDEX "brain_usages_user_id_created_at_idx" ON "brain_usages"("user_id", "created_at");

ALTER TABLE "brain_usages" ADD CONSTRAINT "brain_usages_brain_agent_id_fkey" FOREIGN KEY ("brain_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_usages" ADD CONSTRAINT "brain_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brain_usages" ADD CONSTRAINT "brain_usages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
