-- CreateTable
CREATE TABLE "gtm_discovery_plans" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "idea_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "content" JSONB,
    "error_message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gtm_discovery_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gtm_discovery_plans_org_id_status_created_at_idx" ON "gtm_discovery_plans"("org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "gtm_discovery_plans_org_id_version_key" ON "gtm_discovery_plans"("org_id", "version");

-- AddForeignKey
ALTER TABLE "gtm_discovery_plans" ADD CONSTRAINT "gtm_discovery_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
