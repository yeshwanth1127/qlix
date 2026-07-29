-- Lead generation tables

CREATE TABLE "lead_campaigns" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "search_query" TEXT NOT NULL,
    "location" TEXT,
    "max_results" INTEGER NOT NULL DEFAULT 25,
    "outreach_config" JSONB NOT NULL DEFAULT '{}',
    "agent_run_id" TEXT,
    "scrape_job_id" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating" DOUBLE PRECISION,
    "review_count" INTEGER,
    "place_id" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "social_links" JSONB NOT NULL DEFAULT '{}',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'scraped',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_outreach" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "subject" TEXT,
    "body_preview" TEXT,
    "action_log_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "lead_outreach_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_campaigns_org_id_created_at_idx" ON "lead_campaigns"("org_id", "created_at" DESC);
CREATE INDEX "lead_campaigns_status_idx" ON "lead_campaigns"("status");
CREATE INDEX "leads_campaign_id_created_at_idx" ON "leads"("campaign_id", "created_at" DESC);
CREATE INDEX "leads_org_id_idx" ON "leads"("org_id");
CREATE INDEX "lead_outreach_campaign_id_idx" ON "lead_outreach"("campaign_id");
CREATE INDEX "lead_outreach_lead_id_idx" ON "lead_outreach"("lead_id");

ALTER TABLE "lead_campaigns" ADD CONSTRAINT "lead_campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_campaigns" ADD CONSTRAINT "lead_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "lead_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_outreach" ADD CONSTRAINT "lead_outreach_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "lead_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_outreach" ADD CONSTRAINT "lead_outreach_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
