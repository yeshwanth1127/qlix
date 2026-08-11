-- Drop lead generation product tables and TeamRun review columns.

ALTER TABLE "team_runs" DROP COLUMN IF EXISTS "lead_campaign_id";
ALTER TABLE "team_runs" DROP COLUMN IF EXISTS "lead_outreach_approved_at";

DROP TABLE IF EXISTS "lead_outreach";
DROP TABLE IF EXISTS "leads";
DROP TABLE IF EXISTS "lead_campaigns";
