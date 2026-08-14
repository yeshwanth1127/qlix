CREATE TABLE "team_mailbox_messages" (
    "id" TEXT NOT NULL,
    "team_run_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'result',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sender_agent_id" TEXT,
    "recipient_agent_id" TEXT,
    "a2a_task_id" TEXT,
    "agent_run_id" TEXT,
    "contract_id" TEXT,
    "payload" JSONB NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "team_mailbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "team_mailbox_messages_team_run_id_kind_created_at_idx"
    ON "team_mailbox_messages"("team_run_id", "kind", "created_at");
CREATE INDEX "team_mailbox_messages_team_run_id_status_idx"
    ON "team_mailbox_messages"("team_run_id", "status");
CREATE INDEX "team_mailbox_messages_a2a_task_id_idx"
    ON "team_mailbox_messages"("a2a_task_id");
CREATE INDEX "team_mailbox_messages_agent_run_id_idx"
    ON "team_mailbox_messages"("agent_run_id");

ALTER TABLE "team_mailbox_messages"
    ADD CONSTRAINT "team_mailbox_messages_team_run_id_fkey"
    FOREIGN KEY ("team_run_id") REFERENCES "team_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
