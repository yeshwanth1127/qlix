ALTER TABLE "org_plugins"
  ADD COLUMN "lifecycle_state" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "lifecycle_error" TEXT;
