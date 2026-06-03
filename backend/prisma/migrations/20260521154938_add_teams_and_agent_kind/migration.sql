-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "team_id" TEXT,
ADD COLUMN     "team_role" TEXT,
ADD COLUMN     "team_run_id" TEXT;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "supervisor_agent_id" TEXT,
    "did" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "delegated_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_card_snapshot" JSONB,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_runs" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "started_by_user_id" UUID NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "supervisor_trace" JSONB NOT NULL DEFAULT '[]',
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "scope_escalations" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "team_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_run_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "seq" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "timestamp_ms" BIGINT NOT NULL,

    CONSTRAINT "team_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "a2a_tasks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "from_agent_id" TEXT NOT NULL,
    "to_agent_id" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "input_request" JSONB,
    "input_response" JSONB,
    "error_message" TEXT,
    "agent_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "a2a_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_did_key" ON "teams"("did");

-- CreateIndex
CREATE INDEX "teams_org_id_idx" ON "teams"("org_id");

-- CreateIndex
CREATE INDEX "teams_created_by_user_id_idx" ON "teams"("created_by_user_id");

-- CreateIndex
CREATE INDEX "team_members_team_id_idx" ON "team_members"("team_id");

-- CreateIndex
CREATE INDEX "team_members_agent_id_idx" ON "team_members"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_agent_id_key" ON "team_members"("team_id", "agent_id");

-- CreateIndex
CREATE INDEX "team_runs_team_id_created_at_idx" ON "team_runs"("team_id", "created_at");

-- CreateIndex
CREATE INDEX "team_runs_org_id_created_at_idx" ON "team_runs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "team_runs_status_created_at_idx" ON "team_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "team_run_events_run_id_timestamp_ms_idx" ON "team_run_events"("run_id", "timestamp_ms");

-- CreateIndex
CREATE INDEX "team_run_events_team_id_timestamp_ms_idx" ON "team_run_events"("team_id", "timestamp_ms");

-- CreateIndex
CREATE UNIQUE INDEX "team_run_events_run_id_seq_key" ON "team_run_events"("run_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "a2a_tasks_agent_run_id_key" ON "a2a_tasks"("agent_run_id");

-- CreateIndex
CREATE INDEX "a2a_tasks_run_id_idx" ON "a2a_tasks"("run_id");

-- CreateIndex
CREATE INDEX "a2a_tasks_to_agent_id_status_idx" ON "a2a_tasks"("to_agent_id", "status");

-- CreateIndex
CREATE INDEX "agent_runs_team_run_id_idx" ON "agent_runs"("team_run_id");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_team_run_id_fkey" FOREIGN KEY ("team_run_id") REFERENCES "team_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_supervisor_agent_id_fkey" FOREIGN KEY ("supervisor_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_runs" ADD CONSTRAINT "team_runs_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_runs" ADD CONSTRAINT "team_runs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_run_events" ADD CONSTRAINT "team_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
