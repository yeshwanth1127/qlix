-- Brain document review and freshness metadata for governed GTM retrieval.
ALTER TABLE "brain_knowledge_documents"
  ADD COLUMN "review_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "reviewed_by_user_id" UUID,
  ADD COLUMN "source_observed_at" TIMESTAMP(3),
  ADD COLUMN "freshness_expires_at" TIMESTAMP(3);

CREATE INDEX "brain_knowledge_documents_org_id_review_status_idx"
  ON "brain_knowledge_documents"("org_id", "review_status");

-- Structured GTM setup proposals (confirm before mutating plugin config).
CREATE TABLE "gtm_setup_proposals" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "patch" JSONB NOT NULL,
  "rationale" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'exa',
  "created_by" UUID NOT NULL,
  "resolved_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "gtm_setup_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gtm_setup_proposals_org_id_status_idx"
  ON "gtm_setup_proposals"("org_id", "status");

ALTER TABLE "gtm_setup_proposals"
  ADD CONSTRAINT "gtm_setup_proposals_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
