-- Zero-to-one GTM discovery foundation: versioned ideas, hypotheses, evidence, and proposals.
CREATE TABLE "gtm_ideas" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "content" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'operator',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMP(3),
  CONSTRAINT "gtm_ideas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gtm_hypotheses" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "owner_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gtm_hypotheses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gtm_hypothesis_versions" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "hypothesis_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "statement" TEXT NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "evidence_class" TEXT NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gtm_hypothesis_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gtm_hypothesis_evidence" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "hypothesis_version_id" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "evidence_id" TEXT,
  "relationship" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gtm_hypothesis_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gtm_discovery_proposals" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload" JSONB NOT NULL,
  "rationale" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'operator',
  "created_by" UUID NOT NULL,
  "resolved_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "gtm_discovery_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gtm_ideas_org_id_version_key" ON "gtm_ideas"("org_id", "version");
CREATE INDEX "gtm_ideas_org_id_status_idx" ON "gtm_ideas"("org_id", "status");
CREATE INDEX "gtm_hypotheses_org_id_kind_status_idx" ON "gtm_hypotheses"("org_id", "kind", "status");
CREATE UNIQUE INDEX "gtm_hypothesis_versions_hypothesis_id_version_key" ON "gtm_hypothesis_versions"("hypothesis_id", "version");
CREATE INDEX "gtm_hypothesis_versions_org_id_created_at_idx" ON "gtm_hypothesis_versions"("org_id", "created_at");
CREATE INDEX "gtm_hypothesis_evidence_org_id_relationship_idx" ON "gtm_hypothesis_evidence"("org_id", "relationship");
CREATE INDEX "gtm_hypothesis_evidence_hypothesis_version_id_idx" ON "gtm_hypothesis_evidence"("hypothesis_version_id");
CREATE INDEX "gtm_discovery_proposals_org_id_status_created_at_idx" ON "gtm_discovery_proposals"("org_id", "status", "created_at");

ALTER TABLE "gtm_ideas" ADD CONSTRAINT "gtm_ideas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_hypotheses" ADD CONSTRAINT "gtm_hypotheses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_hypothesis_versions" ADD CONSTRAINT "gtm_hypothesis_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_hypothesis_versions" ADD CONSTRAINT "gtm_hypothesis_versions_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "gtm_hypotheses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_hypothesis_evidence" ADD CONSTRAINT "gtm_hypothesis_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_hypothesis_evidence" ADD CONSTRAINT "gtm_hypothesis_evidence_hypothesis_version_id_fkey" FOREIGN KEY ("hypothesis_version_id") REFERENCES "gtm_hypothesis_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_discovery_proposals" ADD CONSTRAINT "gtm_discovery_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
