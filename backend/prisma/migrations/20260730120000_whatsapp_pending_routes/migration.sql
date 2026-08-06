CREATE TABLE IF NOT EXISTS "whatsapp_pending_routes" (
    "connector_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "brain_flag" BOOLEAN NOT NULL DEFAULT false,
    "options_json" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_pending_routes_pkey" PRIMARY KEY ("connector_id")
);
