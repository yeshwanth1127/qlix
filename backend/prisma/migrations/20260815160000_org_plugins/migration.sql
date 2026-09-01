-- CreateTable
CREATE TABLE "org_plugins" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled_by_user_id" UUID NOT NULL,
    "disabled_at" TIMESTAMP(3),

    CONSTRAINT "org_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_plugins_org_id_enabled_idx" ON "org_plugins"("org_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "org_plugins_org_id_plugin_id_key" ON "org_plugins"("org_id", "plugin_id");

-- AddForeignKey
ALTER TABLE "org_plugins" ADD CONSTRAINT "org_plugins_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

