-- Fills a gap in migration history: the `employee_engagements` table (model
-- EmployeeEngagement in schema.prisma) was never captured in a tracked
-- migration — it must have been applied out-of-band on prior databases via
-- `prisma db push`. The next migration, 20260801120000_gateway_profiles_
-- schedules_skills, adds a foreign key from employee_schedules to this table
-- and fails on a from-scratch rebuild without it existing first. This
-- migration is generated to exactly match the current schema.prisma model.

CREATE TABLE "employee_engagements" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "workspace_org_id" UUID NOT NULL,
    "hired_by_user_id" UUID NOT NULL,
    "role_slug" TEXT NOT NULL,
    "pack_version" TEXT NOT NULL,
    "pack_hash" TEXT NOT NULL,
    "pack_snapshot" JSONB NOT NULL,
    "config_overrides" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "hired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMP(3),
    "terminated_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,

    CONSTRAINT "employee_engagements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_engagements_agent_id_key" ON "employee_engagements"("agent_id");

CREATE INDEX "employee_engagements_workspace_org_id_idx" ON "employee_engagements"("workspace_org_id");

CREATE INDEX "employee_engagements_role_slug_idx" ON "employee_engagements"("role_slug");

CREATE INDEX "employee_engagements_status_idx" ON "employee_engagements"("status");

ALTER TABLE "employee_engagements" ADD CONSTRAINT "employee_engagements_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_engagements" ADD CONSTRAINT "employee_engagements_hired_by_user_id_fkey" FOREIGN KEY ("hired_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
