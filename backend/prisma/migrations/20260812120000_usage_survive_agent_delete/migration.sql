-- Preserve token usage after agent deletion (mirror ActionLog / VC SetNull pattern).
-- agent_key / agent_name are durable snapshots; live FKs become nullable SetNull.
-- run_usages.run_id must also SetNull so Agent → AgentRun cascade does not wipe usage.

-- run_usages: add snapshot columns
ALTER TABLE "run_usages" ADD COLUMN "agent_key" TEXT;
ALTER TABLE "run_usages" ADD COLUMN "agent_name" VARCHAR(160);

UPDATE "run_usages" AS ru
SET
  "agent_key" = ru."agent_id",
  "agent_name" = COALESCE(a."name", ru."agent_id")
FROM "agents" a
WHERE a."id" = ru."agent_id";

UPDATE "run_usages"
SET
  "agent_key" = COALESCE("agent_key", "agent_id"),
  "agent_name" = COALESCE("agent_name", "agent_id")
WHERE "agent_key" IS NULL OR "agent_name" IS NULL;

ALTER TABLE "run_usages" ALTER COLUMN "agent_key" SET NOT NULL;
ALTER TABLE "run_usages" ALTER COLUMN "agent_name" SET NOT NULL;

DROP INDEX IF EXISTS "run_usages_agent_id_created_at_idx";
ALTER TABLE "run_usages" DROP CONSTRAINT "run_usages_agent_id_fkey";
ALTER TABLE "run_usages" DROP CONSTRAINT "run_usages_run_id_fkey";

ALTER TABLE "run_usages" ALTER COLUMN "agent_id" DROP NOT NULL;
ALTER TABLE "run_usages" ALTER COLUMN "run_id" DROP NOT NULL;

CREATE INDEX "run_usages_agent_id_created_at_idx" ON "run_usages"("agent_id", "created_at");
CREATE INDEX "run_usages_agent_key_created_at_idx" ON "run_usages"("agent_key", "created_at");

ALTER TABLE "run_usages" ADD CONSTRAINT "run_usages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "run_usages" ADD CONSTRAINT "run_usages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- brain_usages: add snapshot columns
ALTER TABLE "brain_usages" ADD COLUMN "agent_key" TEXT;
ALTER TABLE "brain_usages" ADD COLUMN "agent_name" VARCHAR(160);

UPDATE "brain_usages" AS bu
SET
  "agent_key" = bu."brain_agent_id",
  "agent_name" = COALESCE(a."name", bu."brain_agent_id")
FROM "agents" a
WHERE a."id" = bu."brain_agent_id";

UPDATE "brain_usages"
SET
  "agent_key" = COALESCE("agent_key", "brain_agent_id"),
  "agent_name" = COALESCE("agent_name", "brain_agent_id")
WHERE "agent_key" IS NULL OR "agent_name" IS NULL;

ALTER TABLE "brain_usages" ALTER COLUMN "agent_key" SET NOT NULL;
ALTER TABLE "brain_usages" ALTER COLUMN "agent_name" SET NOT NULL;

DROP INDEX IF EXISTS "brain_usages_brain_agent_id_created_at_idx";
ALTER TABLE "brain_usages" DROP CONSTRAINT "brain_usages_brain_agent_id_fkey";

ALTER TABLE "brain_usages" ALTER COLUMN "brain_agent_id" DROP NOT NULL;

CREATE INDEX "brain_usages_brain_agent_id_created_at_idx" ON "brain_usages"("brain_agent_id", "created_at");
CREATE INDEX "brain_usages_agent_key_created_at_idx" ON "brain_usages"("agent_key", "created_at");

ALTER TABLE "brain_usages" ADD CONSTRAINT "brain_usages_brain_agent_id_fkey" FOREIGN KEY ("brain_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
