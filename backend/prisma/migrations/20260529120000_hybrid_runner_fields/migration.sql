-- Hybrid runner: local daemon auth + heartbeat
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "hybrid_runner_token_hash" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "hybrid_last_heartbeat_at" TIMESTAMP(3);
