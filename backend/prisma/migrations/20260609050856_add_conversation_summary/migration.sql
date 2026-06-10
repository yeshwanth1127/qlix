-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN     "summarized_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary" TEXT;
