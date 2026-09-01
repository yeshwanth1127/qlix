ALTER TABLE "nl_builder_sessions"
  ADD COLUMN "phase" VARCHAR(32) NOT NULL DEFAULT 'discovering',
  ADD COLUMN "state_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "latest_message_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requirements" JSONB NOT NULL DEFAULT '{"facts":[],"unresolved":[],"assumptions":[]}',
  ADD COLUMN "readiness" JSONB NOT NULL DEFAULT '{"score":0,"canPlan":false,"blocking":[]}',
  ADD COLUMN "rolling_summary" TEXT NOT NULL DEFAULT '';

CREATE TABLE "nl_builder_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "content" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'completed',
  "model" VARCHAR(200),
  "provider" VARCHAR(40),
  "input_tokens" INTEGER,
  "cached_input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "nl_builder_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nl_builder_requirement_facts" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "value" JSONB NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "source_message_id" TEXT NOT NULL,
  "supersedes_fact_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nl_builder_requirement_facts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nl_builder_state_snapshots" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "requirements" JSONB NOT NULL,
  "readiness" JSONB NOT NULL,
  "derived_through_sequence" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nl_builder_state_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nl_builder_state_events" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "payload" JSONB NOT NULL,
  "from_version" INTEGER NOT NULL,
  "to_version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nl_builder_state_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nl_builder_memory_summaries" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "type" VARCHAR(24) NOT NULL,
  "topic" VARCHAR(100),
  "content" TEXT NOT NULL,
  "covered_from_sequence" INTEGER NOT NULL,
  "covered_through_sequence" INTEGER NOT NULL,
  "token_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nl_builder_memory_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nl_builder_plans" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "requirements_version" INTEGER NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "plan" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "nl_builder_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nl_builder_messages_session_id_sequence_key" ON "nl_builder_messages"("session_id", "sequence");
CREATE INDEX "nl_builder_messages_session_id_created_at_idx" ON "nl_builder_messages"("session_id", "created_at");
CREATE INDEX "nl_builder_requirement_facts_session_id_status_category_idx" ON "nl_builder_requirement_facts"("session_id", "status", "category");
CREATE INDEX "nl_builder_requirement_facts_session_id_key_status_idx" ON "nl_builder_requirement_facts"("session_id", "key", "status");
CREATE UNIQUE INDEX "nl_builder_state_snapshots_session_id_version_key" ON "nl_builder_state_snapshots"("session_id", "version");
CREATE INDEX "nl_builder_state_events_session_id_created_at_idx" ON "nl_builder_state_events"("session_id", "created_at");
CREATE INDEX "nl_builder_memory_summaries_session_id_type_updated_at_idx" ON "nl_builder_memory_summaries"("session_id", "type", "updated_at");
CREATE UNIQUE INDEX "nl_builder_plans_session_id_plan_version_key" ON "nl_builder_plans"("session_id", "plan_version");
CREATE INDEX "nl_builder_plans_session_id_status_idx" ON "nl_builder_plans"("session_id", "status");

ALTER TABLE "nl_builder_messages" ADD CONSTRAINT "nl_builder_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nl_builder_requirement_facts" ADD CONSTRAINT "nl_builder_requirement_facts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nl_builder_state_snapshots" ADD CONSTRAINT "nl_builder_state_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nl_builder_state_events" ADD CONSTRAINT "nl_builder_state_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nl_builder_memory_summaries" ADD CONSTRAINT "nl_builder_memory_summaries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nl_builder_plans" ADD CONSTRAINT "nl_builder_plans_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "nl_builder_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
