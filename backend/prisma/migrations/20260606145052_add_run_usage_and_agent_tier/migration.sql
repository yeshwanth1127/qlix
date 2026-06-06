-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "agent_tier" TEXT NOT NULL DEFAULT 'free';

-- CreateTable
CREATE TABLE "run_usages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "org_id" UUID,
    "user_id" UUID NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "model" TEXT,
    "provider" TEXT,
    "openrouter_gen_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_usages_run_id_key" ON "run_usages"("run_id");

-- CreateIndex
CREATE INDEX "run_usages_agent_id_created_at_idx" ON "run_usages"("agent_id", "created_at");

-- CreateIndex
CREATE INDEX "run_usages_org_id_created_at_idx" ON "run_usages"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "run_usages_user_id_created_at_idx" ON "run_usages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "run_usages" ADD CONSTRAINT "run_usages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_usages" ADD CONSTRAINT "run_usages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
