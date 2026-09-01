-- CreateTable
CREATE TABLE "device_grants" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "subject_user_id" UUID,
    "device_label" TEXT NOT NULL,
    "workspace_root" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "allowed_actions" TEXT[] DEFAULT ARRAY['evidence.ingest']::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_grants_token_hash_key" ON "device_grants"("token_hash");

-- CreateIndex
CREATE INDEX "device_grants_session_id_idx" ON "device_grants"("session_id");

-- CreateIndex
CREATE INDEX "device_grants_expires_at_idx" ON "device_grants"("expires_at");

-- AddForeignKey
ALTER TABLE "device_grants" ADD CONSTRAINT "device_grants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

