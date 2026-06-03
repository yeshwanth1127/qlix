-- Drop FKs that reference agents.id (types will change from UUID to TEXT for cuid).
ALTER TABLE "action_logs" DROP CONSTRAINT IF EXISTS "action_logs_agent_id_fkey";
ALTER TABLE "successful_events" DROP CONSTRAINT IF EXISTS "successful_events_agent_id_fkey";
ALTER TABLE "failed_events" DROP CONSTRAINT IF EXISTS "failed_events_agent_id_fkey";

-- Primary key on agents must be dropped before altering id type.
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_pkey";

-- Align child FK columns to text (UUID values become matching text).
ALTER TABLE "action_logs" ALTER COLUMN "agent_id" SET DATA TYPE TEXT USING "agent_id"::text;
ALTER TABLE "successful_events" ALTER COLUMN "agent_id" SET DATA TYPE TEXT USING "agent_id"::text;
ALTER TABLE "failed_events" ALTER COLUMN "agent_id" SET DATA TYPE TEXT USING "agent_id"::text;

-- Agent primary key: UUID -> TEXT (existing rows keep the same string form).
ALTER TABLE "agents" ALTER COLUMN "id" SET DATA TYPE TEXT USING "id"::text;
ALTER TABLE "agents" ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");

-- Optional org
ALTER TABLE "agents" ALTER COLUMN "org_id" DROP NOT NULL;

-- permission_scopes: JSONB -> text[] (cannot use subquery inside ALTER ... USING; use temp column + UPDATE)
ALTER TABLE "agents" ADD COLUMN "permission_scopes_new" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "agents" SET "permission_scopes_new" = CASE
  WHEN "permission_scopes" IS NULL THEN ARRAY[]::TEXT[]
  WHEN jsonb_typeof("permission_scopes") = 'array' THEN COALESCE(
    ARRAY(SELECT jsonb_array_elements_text("permission_scopes")),
    ARRAY[]::TEXT[]
  )
  ELSE ARRAY[]::TEXT[]
END;

ALTER TABLE "agents" DROP COLUMN "permission_scopes";
ALTER TABLE "agents" RENAME COLUMN "permission_scopes_new" TO "permission_scopes";
ALTER TABLE "agents" ALTER COLUMN "permission_scopes" SET DEFAULT ARRAY[]::TEXT[];

-- New agent fields
ALTER TABLE "agents" ADD COLUMN "runtime" TEXT NOT NULL DEFAULT 'cloud';
ALTER TABLE "agents" ADD COLUMN "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';
ALTER TABLE "agents" ADD COLUMN "jit_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "agents" ADD COLUMN "always_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "agents" ADD COLUMN "webauthn_credential_id" TEXT;
ALTER TABLE "agents" ADD COLUMN "keypair_delivered_at" TIMESTAMP(3);
ALTER TABLE "agents" ADD COLUMN "last_connected_at" TIMESTAMP(3);

-- Recreate FKs (agent id is TEXT)
ALTER TABLE "action_logs" ADD CONSTRAINT "action_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "successful_events" ADD CONSTRAINT "successful_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "failed_events" ADD CONSTRAINT "failed_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
