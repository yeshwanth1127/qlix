-- Durable external-event waits for paused team pipelines and future agent continuations.
ALTER TABLE "team_runs"
  ADD COLUMN IF NOT EXISTS "checkpoint_json" JSONB;

CREATE TABLE IF NOT EXISTS "wait_triggers" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "fulfillment" TEXT NOT NULL DEFAULT 'first_match',
  "connector_id" UUID,
  "contact_jid" TEXT,
  "agent_id" TEXT,
  "continuation_kind" TEXT NOT NULL,
  "team_run_id" TEXT,
  "reply_instructions" TEXT,
  "inbound_json" JSONB NOT NULL DEFAULT '[]',
  "armed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "fulfilled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wait_triggers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wait_triggers_connector_id_contact_jid_status_expires_at_idx"
  ON "wait_triggers"("connector_id", "contact_jid", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "wait_triggers_team_run_id_status_idx"
  ON "wait_triggers"("team_run_id", "status");
CREATE INDEX IF NOT EXISTS "wait_triggers_status_kind_expires_at_idx"
  ON "wait_triggers"("status", "kind", "expires_at");

ALTER TABLE "wait_triggers"
  ADD CONSTRAINT "wait_triggers_team_run_id_fkey"
  FOREIGN KEY ("team_run_id") REFERENCES "team_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
