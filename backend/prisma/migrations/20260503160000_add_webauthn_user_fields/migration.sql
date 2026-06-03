-- AlterTable
ALTER TABLE "users" ADD COLUMN     "webauthn_credential_id" TEXT,
ADD COLUMN     "webauthn_public_key" TEXT,
ADD COLUMN     "webauthn_counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "device_verified" BOOLEAN NOT NULL DEFAULT false;
