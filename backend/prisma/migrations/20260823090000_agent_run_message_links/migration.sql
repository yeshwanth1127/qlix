ALTER TABLE "agent_runs"
  ADD COLUMN "input_message_id" TEXT,
  ADD COLUMN "output_message_id" TEXT;

CREATE INDEX "agent_runs_input_message_id_idx" ON "agent_runs"("input_message_id");
CREATE INDEX "agent_runs_output_message_id_idx" ON "agent_runs"("output_message_id");
