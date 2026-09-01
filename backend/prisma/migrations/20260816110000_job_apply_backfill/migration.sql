-- Another gap in migration history, found the same way as employee_engagements:
-- the job_candidate_profiles / job_apply_campaigns / job_applications tables
-- (JobCandidateProfile / JobApplyCampaign / JobApplication in schema.prisma)
-- and a handful of column-default tweaks were applied out-of-band (`db push`)
-- on prior databases and never captured as a tracked migration. Generated
-- from `prisma migrate diff` against the current schema.prisma so a from-
-- scratch rebuild produces the exact same shape as the databases this was
-- previously applied to informally.

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "model" SET DEFAULT 'openrouter/qlix/auto';

-- AlterTable
ALTER TABLE "brain_agent_proposals" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "brain_conversations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "builder_canvases" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "jit_scope_grants" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wait_triggers" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "whatsapp_auto_reply_sessions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "job_candidate_profiles" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "portfolio_url" TEXT,
    "work_auth" TEXT,
    "salary_band" TEXT,
    "summary" TEXT,
    "experience" JSONB NOT NULL DEFAULT '[]',
    "education" JSONB NOT NULL DEFAULT '[]',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answer_bank" JSONB NOT NULL DEFAULT '[]',
    "resume_sandbox_id" TEXT,
    "resume_file_name" TEXT,
    "resume_mime_type" TEXT,
    "resume_url" TEXT,
    "resume_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_apply_campaigns" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "profile_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "search_query" TEXT,
    "boards" JSONB NOT NULL DEFAULT '[]',
    "agent_id" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_apply_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "apply_url" TEXT NOT NULL,
    "ats" TEXT NOT NULL DEFAULT 'unknown',
    "external_job_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result_note" TEXT,
    "confirmation_url" TEXT,
    "agent_run_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_candidate_profiles_org_id_idx" ON "job_candidate_profiles"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_candidate_profiles_org_id_user_id_key" ON "job_candidate_profiles"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "job_apply_campaigns_org_id_created_at_idx" ON "job_apply_campaigns"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_apply_campaigns_status_idx" ON "job_apply_campaigns"("status");

-- CreateIndex
CREATE INDEX "job_applications_campaign_id_status_idx" ON "job_applications"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "job_applications_org_id_idx" ON "job_applications"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_campaign_id_apply_url_key" ON "job_applications"("campaign_id", "apply_url");

-- AddForeignKey
ALTER TABLE "job_candidate_profiles" ADD CONSTRAINT "job_candidate_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_candidate_profiles" ADD CONSTRAINT "job_candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_apply_campaigns" ADD CONSTRAINT "job_apply_campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_apply_campaigns" ADD CONSTRAINT "job_apply_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_apply_campaigns" ADD CONSTRAINT "job_apply_campaigns_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "job_candidate_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "job_apply_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "conversation_bindings_org_id_channel_connector_id_key_type_key_" RENAME TO "conversation_bindings_org_id_channel_connector_id_key_type__idx";

-- RenameIndex
ALTER INDEX "conversation_processes_org_id_external_ref_type_external_ref_id" RENAME TO "conversation_processes_org_id_external_ref_type_external_re_key";
