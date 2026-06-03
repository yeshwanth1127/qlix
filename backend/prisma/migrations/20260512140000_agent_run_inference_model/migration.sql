-- Per-chat-run OpenRouter model override (null = cloud runner manifest default).
ALTER TABLE "agent_runs" ADD COLUMN "inference_model" TEXT;
