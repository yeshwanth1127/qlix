-- Saved Visual Builder canvases. Draft-only: rows here never mutate agents or teams.
CREATE TABLE "builder_canvases" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "graph" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "builder_canvases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "builder_canvases_org_id_updated_at_idx" ON "builder_canvases"("org_id", "updated_at");
CREATE INDEX "builder_canvases_created_by_user_id_idx" ON "builder_canvases"("created_by_user_id");

ALTER TABLE "builder_canvases" ADD CONSTRAINT "builder_canvases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "builder_canvases" ADD CONSTRAINT "builder_canvases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
