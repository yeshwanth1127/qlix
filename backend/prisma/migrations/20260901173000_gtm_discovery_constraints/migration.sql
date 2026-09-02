-- Fail closed on invalid discovery states and prevent concurrent active idea versions.
ALTER TABLE "gtm_ideas"
  ADD CONSTRAINT "gtm_ideas_status_check" CHECK ("status" IN ('active', 'superseded'));

CREATE UNIQUE INDEX "gtm_ideas_one_active_per_org_key"
  ON "gtm_ideas"("org_id") WHERE "status" = 'active';

ALTER TABLE "gtm_hypotheses"
  ADD CONSTRAINT "gtm_hypotheses_kind_check" CHECK ("kind" IN ('problem', 'segment', 'trigger', 'user', 'champion', 'buyer', 'value', 'offer', 'channel', 'price')),
  ADD CONSTRAINT "gtm_hypotheses_status_check" CHECK ("status" IN ('draft', 'active', 'supported', 'contradicted', 'validated', 'rejected', 'superseded'));

ALTER TABLE "gtm_hypothesis_versions"
  ADD CONSTRAINT "gtm_hypothesis_versions_evidence_class_check" CHECK ("evidence_class" IN ('founder_provided', 'externally_verified', 'inferred', 'prospect_reported', 'experiment_observed', 'unknown'));

ALTER TABLE "gtm_hypothesis_evidence"
  ADD CONSTRAINT "gtm_hypothesis_evidence_relationship_check" CHECK ("relationship" IN ('supports', 'contradicts', 'qualifies', 'unknown'));

ALTER TABLE "gtm_discovery_proposals"
  ADD CONSTRAINT "gtm_discovery_proposals_kind_check" CHECK ("kind" IN ('idea', 'hypothesis')),
  ADD CONSTRAINT "gtm_discovery_proposals_status_check" CHECK ("status" IN ('pending', 'confirmed', 'rejected')),
  ADD CONSTRAINT "gtm_discovery_proposals_source_check" CHECK ("source" IN ('exa', 'operator'));
