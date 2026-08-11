-- Pending Telegram agent-picker state (per connector + chat).
CREATE TABLE IF NOT EXISTS "telegram_pending_routes" (
    "id" UUID NOT NULL,
    "connector_id" UUID NOT NULL,
    "chat_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "brain_flag" BOOLEAN NOT NULL DEFAULT false,
    "options_json" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_pending_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_pending_routes_connector_id_chat_id_key"
  ON "telegram_pending_routes"("connector_id", "chat_id");

CREATE INDEX IF NOT EXISTS "telegram_pending_routes_expires_at_idx"
  ON "telegram_pending_routes"("expires_at");
