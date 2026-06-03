-- Add pipeline stage ordering to team members.
ALTER TABLE "team_members" ADD COLUMN "stage_order" INTEGER NOT NULL DEFAULT 0;

-- Backfill stage_order for existing rows so older teams keep current execution order
-- (ordered by added_at, 1-indexed).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY added_at ASC, id ASC) AS rn
  FROM "team_members"
)
UPDATE "team_members" tm
SET stage_order = ordered.rn
FROM ordered
WHERE tm.id = ordered.id;

CREATE INDEX "team_members_team_id_stage_order_idx" ON "team_members" ("team_id", "stage_order");
