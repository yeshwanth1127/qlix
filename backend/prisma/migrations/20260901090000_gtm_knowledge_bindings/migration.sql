-- Bind stable GTM purposes to the existing AI Brain collection substrate.
CREATE TABLE "gtm_knowledge_bindings" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL,
  "collection_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gtm_knowledge_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gtm_knowledge_bindings_collection_id_key"
  ON "gtm_knowledge_bindings"("collection_id");
CREATE UNIQUE INDEX "gtm_knowledge_bindings_org_id_purpose_key"
  ON "gtm_knowledge_bindings"("org_id", "purpose");
CREATE INDEX "gtm_knowledge_bindings_org_id_idx"
  ON "gtm_knowledge_bindings"("org_id");

ALTER TABLE "gtm_knowledge_bindings"
  ADD CONSTRAINT "gtm_knowledge_bindings_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gtm_knowledge_bindings"
  ADD CONSTRAINT "gtm_knowledge_bindings_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "brain_knowledge_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
