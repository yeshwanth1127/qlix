-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "llm_mode" TEXT NOT NULL DEFAULT 'proxy';
