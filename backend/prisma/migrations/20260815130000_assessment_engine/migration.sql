-- CreateTable
CREATE TABLE "work_sessions" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "subject_user_id" UUID,
    "subject_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "team_id" TEXT,
    "framework_id" TEXT,
    "review_process_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "consent_granted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "content_ref" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_snapshots" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "file_tree_hash" TEXT NOT NULL,
    "file_hashes" JSONB NOT NULL DEFAULT '[]',
    "content_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_frameworks" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "integrity_policy" JSONB NOT NULL DEFAULT '{"never_auto_accuse":true,"escalate_to_human_on_suspicion":true}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "framework_id" TEXT NOT NULL,
    "team_run_id" TEXT,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "review_transcript" JSONB NOT NULL DEFAULT '[]',
    "overall_readiness" TEXT NOT NULL DEFAULT 'needs_human_review',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_reports" (
    "id" TEXT NOT NULL,
    "assessment_record_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "human_reviewer_id" UUID,
    "human_decision" TEXT NOT NULL DEFAULT 'pending',
    "jit_request_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_sessions_org_id_status_idx" ON "work_sessions"("org_id", "status");

-- CreateIndex
CREATE INDEX "work_sessions_subject_user_id_idx" ON "work_sessions"("subject_user_id");

-- CreateIndex
CREATE INDEX "evidence_records_session_id_occurred_at_idx" ON "evidence_records"("session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "evidence_records_session_id_kind_idx" ON "evidence_records"("session_id", "kind");

-- CreateIndex
CREATE INDEX "project_snapshots_session_id_created_at_idx" ON "project_snapshots"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "evaluation_frameworks_org_id_recipe_id_idx" ON "evaluation_frameworks"("org_id", "recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_frameworks_org_id_recipe_id_version_key" ON "evaluation_frameworks"("org_id", "recipe_id", "version");

-- CreateIndex
CREATE INDEX "assessment_records_session_id_idx" ON "assessment_records"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_reports_assessment_record_id_key" ON "assessment_reports"("assessment_record_id");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "evaluation_frameworks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_frameworks" ADD CONSTRAINT "evaluation_frameworks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_records" ADD CONSTRAINT "assessment_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_records" ADD CONSTRAINT "assessment_records_team_run_id_fkey" FOREIGN KEY ("team_run_id") REFERENCES "team_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_reports" ADD CONSTRAINT "assessment_reports_assessment_record_id_fkey" FOREIGN KEY ("assessment_record_id") REFERENCES "assessment_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
