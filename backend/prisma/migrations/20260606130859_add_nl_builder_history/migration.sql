-- AlterTable
ALTER TABLE "connector_accounts" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "nl_builder_history" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nl_builder_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nl_builder_history_user_id_created_at_idx" ON "nl_builder_history"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "nl_builder_history" ADD CONSTRAINT "nl_builder_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
