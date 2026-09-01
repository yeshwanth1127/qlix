CREATE TABLE "context_versions" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "context_versions_object_id_version_key"
    ON "context_versions"("object_id", "version");
CREATE INDEX "context_versions_org_id_content_hash_idx"
    ON "context_versions"("org_id", "content_hash");

ALTER TABLE "context_versions"
    ADD CONSTRAINT "context_versions_object_id_fkey"
    FOREIGN KEY ("object_id") REFERENCES "context_objects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "context_versions"
    ADD CONSTRAINT "context_versions_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "context_versions" (
    "id", "object_id", "org_id", "version", "content_hash", "content", "summary", "metadata", "created_at"
)
SELECT
    "id",
    "id",
    "org_id",
    "version",
    "content_hash",
    "content",
    "summary",
    "metadata",
    "created_at"
FROM "context_objects"
ON CONFLICT ("object_id", "version") DO NOTHING;

CREATE TABLE "context_edges" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "from_object_id" TEXT NOT NULL,
    "to_object_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_edges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "context_edges_from_object_id_to_object_id_relation_key"
    ON "context_edges"("from_object_id", "to_object_id", "relation");
CREATE INDEX "context_edges_org_id_relation_idx"
    ON "context_edges"("org_id", "relation");

ALTER TABLE "context_edges"
    ADD CONSTRAINT "context_edges_from_object_id_fkey"
    FOREIGN KEY ("from_object_id") REFERENCES "context_objects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "context_edges"
    ADD CONSTRAINT "context_edges_to_object_id_fkey"
    FOREIGN KEY ("to_object_id") REFERENCES "context_objects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "context_edges"
    ADD CONSTRAINT "context_edges_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
