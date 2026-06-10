-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "disabled_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
