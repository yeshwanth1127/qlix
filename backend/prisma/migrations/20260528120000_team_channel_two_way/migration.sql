-- Team two-way channel: run provenance, default WhatsApp team, sessions, durable injections

ALTER TABLE "team_runs"
  ADD COLUMN IF NOT EXISTS "source_channel" TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "source_connector_id" UUID,
  ADD COLUMN IF NOT EXISTS "reply_channel" TEXT NOT NULL DEFAULT 'none';

ALTER TABLE "connector_accounts"
  ADD COLUMN IF NOT EXISTS "whatsapp_default_team_id" TEXT;

CREATE TABLE IF NOT EXISTS "team_run_channel_sessions" (
  "id" TEXT NOT NULL,
  "connector_id" UUID NOT NULL,
  "team_run_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "team_run_channel_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "team_run_channel_sessions_connector_id_key"
  ON "team_run_channel_sessions"("connector_id");
CREATE UNIQUE INDEX IF NOT EXISTS "team_run_channel_sessions_team_run_id_key"
  ON "team_run_channel_sessions"("team_run_id");
CREATE INDEX IF NOT EXISTS "team_run_channel_sessions_team_run_id_idx"
  ON "team_run_channel_sessions"("team_run_id");

ALTER TABLE "team_run_channel_sessions"
  ADD CONSTRAINT "team_run_channel_sessions_team_run_id_fkey"
  FOREIGN KEY ("team_run_id") REFERENCES "team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "team_runs_source_connector_id_status_idx"
  ON "team_runs"("source_connector_id", "status");

CREATE TABLE IF NOT EXISTS "run_injections" (
  "id" TEXT NOT NULL,
  "agent_run_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" TIMESTAMP(3),
  CONSTRAINT "run_injections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "run_injections_agent_run_id_consumed_at_idx"
  ON "run_injections"("agent_run_id", "consumed_at");
