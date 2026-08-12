-- Shared Telegram update_id claims (cluster-safe dedupe).
CREATE TABLE IF NOT EXISTS "telegram_update_claims" (
    "update_id" BIGINT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_update_claims_pkey" PRIMARY KEY ("update_id")
);

CREATE INDEX IF NOT EXISTS "telegram_update_claims_claimed_at_idx"
  ON "telegram_update_claims"("claimed_at");
