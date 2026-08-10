-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "invocation_kind" TEXT;

-- CreateIndex
CREATE INDEX "agent_runs_parent_run_id_idx" ON "agent_runs"("parent_run_id");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "sub_agent_invocations" (
    "id" TEXT NOT NULL,
    "parent_run_id" TEXT NOT NULL,
    "parent_agent_id" TEXT NOT NULL,
    "child_agent_id" TEXT,
    "child_run_id" TEXT,
    "name" TEXT,
    "prompt" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "depth" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "sub_agent_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sub_agent_invocations_child_run_id_key" ON "sub_agent_invocations"("child_run_id");

-- CreateIndex
CREATE INDEX "sub_agent_invocations_parent_run_id_status_idx" ON "sub_agent_invocations"("parent_run_id", "status");

-- CreateIndex
CREATE INDEX "sub_agent_invocations_parent_agent_id_created_at_idx" ON "sub_agent_invocations"("parent_agent_id", "created_at");

-- AddForeignKey
ALTER TABLE "sub_agent_invocations" ADD CONSTRAINT "sub_agent_invocations_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_invocations" ADD CONSTRAINT "sub_agent_invocations_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_agent_invocations" ADD CONSTRAINT "sub_agent_invocations_child_run_id_fkey" FOREIGN KEY ("child_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
