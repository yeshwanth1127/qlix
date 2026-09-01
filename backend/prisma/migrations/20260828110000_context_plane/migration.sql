CREATE TABLE "context_objects" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "allowed_agent_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "read_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "context_objects_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "context_objects_org_id_kind_created_at_idx"
    ON "context_objects"("org_id", "kind", "created_at");
CREATE INDEX "context_objects_source_type_source_id_idx"
    ON "context_objects"("source_type", "source_id");
CREATE INDEX "context_objects_org_id_content_hash_idx"
    ON "context_objects"("org_id", "content_hash");

ALTER TABLE "context_objects"
    ADD CONSTRAINT "context_objects_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
