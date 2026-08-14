-- Persist where an agent run started so JIT approvals route back to that source.
ALTER TABLE "agent_runs" ADD COLUMN "source_channel" TEXT NOT NULL DEFAULT 'web';

UPDATE "agent_runs"
SET "source_channel" = 'whatsapp'
WHERE "team_role" = 'whatsapp';

UPDATE "agent_runs"
SET "source_channel" = 'slack'
WHERE "team_role" = 'slack';

UPDATE "agent_runs"
SET "source_channel" = 'telegram'
WHERE "team_role" = 'telegram';

UPDATE "agent_runs" ar
SET "source_channel" = tr."source_channel"
FROM "team_runs" tr
WHERE ar."team_run_id" = tr."id"
  AND ar."source_channel" = 'web'
  AND tr."source_channel" IS NOT NULL
  AND tr."source_channel" <> 'web';
