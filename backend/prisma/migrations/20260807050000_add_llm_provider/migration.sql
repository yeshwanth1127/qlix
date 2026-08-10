ALTER TABLE "agents" ADD COLUMN "llm_provider" TEXT;

UPDATE "agents" SET "llm_provider" = 'openrouter';

ALTER TABLE "agents"
  ALTER COLUMN "llm_provider" SET NOT NULL,
  ALTER COLUMN "llm_provider" SET DEFAULT 'exora';
