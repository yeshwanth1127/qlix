-- Link a follow-up TeamRun to the prior run whose chat it continues.
ALTER TABLE "team_runs" ADD COLUMN IF NOT EXISTS "continues_run_id" TEXT;

CREATE INDEX IF NOT EXISTS "team_runs_continues_run_id_idx" ON "team_runs"("continues_run_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'team_runs_continues_run_id_fkey'
  ) THEN
    ALTER TABLE "team_runs"
      ADD CONSTRAINT "team_runs_continues_run_id_fkey"
      FOREIGN KEY ("continues_run_id") REFERENCES "team_runs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
