-- Per-agent and per-run cap on how much of the completion budget a thinking
-- model may spend reasoning. NULL means Qlix picks a small share so the visible
-- answer still fits.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "reasoning_effort" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "reasoning_effort" TEXT;
