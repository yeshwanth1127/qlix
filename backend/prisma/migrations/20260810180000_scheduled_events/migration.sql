-- Generic scheduled events (cron / once / interval) for agents + AI Brain via qlix-schedule MCP.
CREATE TABLE "scheduled_events" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "created_by_agent_id" TEXT,
    "created_by_user_id" UUID,
    "schedule_type" TEXT NOT NULL,
    "cron_expression" TEXT,
    "once_at" TIMESTAMP(3),
    "interval_seconds" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "action_type" TEXT NOT NULL DEFAULT 'agent_run',
    "label" TEXT,
    "prompt" TEXT NOT NULL,
    "payload_json" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_enqueued_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "max_runs" INTEGER,
    "last_error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduled_events_org_id_status_enabled_idx" ON "scheduled_events"("org_id", "status", "enabled");
CREATE INDEX "scheduled_events_enabled_next_run_at_idx" ON "scheduled_events"("enabled", "next_run_at");
CREATE INDEX "scheduled_events_agent_id_idx" ON "scheduled_events"("agent_id");
CREATE INDEX "scheduled_events_created_by_agent_id_idx" ON "scheduled_events"("created_by_agent_id");

ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_created_by_agent_id_fkey" FOREIGN KEY ("created_by_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
