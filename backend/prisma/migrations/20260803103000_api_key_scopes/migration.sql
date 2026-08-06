-- Developer API key scopes for least-privilege programmatic access.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
