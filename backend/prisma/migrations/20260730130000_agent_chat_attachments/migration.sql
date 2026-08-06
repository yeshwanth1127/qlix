-- Add file attachment metadata to agent chat messages and runs.
ALTER TABLE "agent_messages" ADD COLUMN "attachments" JSONB;
ALTER TABLE "agent_runs" ADD COLUMN "attachments" JSONB;
