-- Optional: attach org AI brain context to agent chat runs
ALTER TABLE "agent_runs" ADD COLUMN "use_brain" BOOLEAN NOT NULL DEFAULT false;
