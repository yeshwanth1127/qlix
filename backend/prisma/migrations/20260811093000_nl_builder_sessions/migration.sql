-- CreateTable
CREATE TABLE "nl_builder_sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL DEFAULT 'New chat',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "created_agent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "team_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nl_builder_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nl_builder_sessions_user_id_org_id_updated_at_idx" ON "nl_builder_sessions"("user_id", "org_id", "updated_at");

-- AddForeignKey
ALTER TABLE "nl_builder_sessions" ADD CONSTRAINT "nl_builder_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nl_builder_sessions" ADD CONSTRAINT "nl_builder_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
