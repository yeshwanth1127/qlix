CREATE TABLE "execution_run_states" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "execution_id" TEXT NOT NULL,
    "execution_kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "namespaces" JSONB NOT NULL DEFAULT '{}',
    "applied_patch_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_run_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "execution_run_states_execution_kind_execution_id_key"
    ON "execution_run_states"("execution_kind", "execution_id");
CREATE INDEX "execution_run_states_org_id_updated_at_idx"
    ON "execution_run_states"("org_id", "updated_at");

ALTER TABLE "execution_run_states"
    ADD CONSTRAINT "execution_run_states_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
