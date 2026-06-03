-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "cloud_last_heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "cloud_private_key_enc" TEXT,
ADD COLUMN     "cloud_provisioning_status" TEXT,
ADD COLUMN     "cloud_runner_id" TEXT;
