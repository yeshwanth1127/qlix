-- AlterTable
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "tool_profile" TEXT NOT NULL DEFAULT 'full';

-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN IF NOT EXISTS "session_key" TEXT;
CREATE INDEX IF NOT EXISTS "agent_conversations_session_key_idx" ON "agent_conversations"("session_key");

-- CreateTable
CREATE TABLE IF NOT EXISTS "employee_schedules" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "engagement_id" TEXT,
    "cron_expression" TEXT NOT NULL,
    "label" TEXT,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_enqueued_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "employee_schedules_org_id_enabled_idx" ON "employee_schedules"("org_id", "enabled");
CREATE INDEX IF NOT EXISTS "employee_schedules_next_run_at_idx" ON "employee_schedules"("next_run_at");
CREATE INDEX IF NOT EXISTS "employee_schedules_agent_id_idx" ON "employee_schedules"("agent_id");

-- CreateTable
CREATE TABLE IF NOT EXISTS "org_skills" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "source_run_id" TEXT,
    "source_agent_id" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_at" TIMESTAMP(3),
    "approved_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_skills_org_id_name_key" ON "org_skills"("org_id", "name");
CREATE INDEX IF NOT EXISTS "org_skills_org_id_status_idx" ON "org_skills"("org_id", "status");

-- FKs (Prisma maps Organization model to "Organization" table)
DO $$ BEGIN
  ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "employee_schedules" ADD CONSTRAINT "employee_schedules_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "employee_engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_skills" ADD CONSTRAINT "org_skills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_skills" ADD CONSTRAINT "org_skills_source_agent_id_fkey" FOREIGN KEY ("source_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
