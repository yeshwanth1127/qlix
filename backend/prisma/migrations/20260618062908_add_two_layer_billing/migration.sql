-- AlterTable
ALTER TABLE "pricing_tiers" ADD COLUMN     "allowed_model_tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "free_monthly_credit" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "max_agents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsapp_msg_limit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "credit_kind" TEXT;

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "free_balance" DECIMAL(18,8) NOT NULL DEFAULT 0,
ADD COLUMN     "free_expires_at" TIMESTAMP(3),
ADD COLUMN     "paid_balance" DECIMAL(18,8) NOT NULL DEFAULT 0,
ALTER COLUMN "currency" SET DEFAULT 'INR';

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "transport" TEXT NOT NULL DEFAULT 'http',
    "endpoint_url" TEXT,
    "command" TEXT,
    "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auth_type" TEXT NOT NULL DEFAULT 'none',
    "secret_enc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "protocol_version" TEXT,
    "server_info" JSONB,
    "last_error" TEXT,
    "last_discovered_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "oauth_issuer" TEXT,
    "oauth_authorization_endpoint" TEXT,
    "oauth_token_endpoint" TEXT,
    "oauth_registration_endpoint" TEXT,
    "oauth_resource" TEXT,
    "oauth_client_id" TEXT,
    "oauth_scope" TEXT,
    "oauth_auth_params" TEXT,
    "oauth_connected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_sessions" (
    "id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "expires_at_ms" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_tools" (
    "id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "input_schema" JSONB,
    "annotations" JSONB,
    "risk_level" TEXT NOT NULL DEFAULT 'low',
    "default_governance" TEXT NOT NULL DEFAULT 'auto',
    "definition_hash" TEXT NOT NULL,
    "approved_hash" TEXT,
    "approved_definition" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_mcp_bindings" (
    "id" UUID NOT NULL,
    "agent_id" TEXT NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_mcp_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_tiers" (
    "id" UUID NOT NULL,
    "tier_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "price_per_step" DECIMAL(18,8) NOT NULL,
    "model_prefixes" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_servers_org_id_idx" ON "mcp_servers"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_org_id_slug_key" ON "mcp_servers"("org_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_sessions_state_key" ON "mcp_oauth_sessions"("state");

-- CreateIndex
CREATE INDEX "mcp_oauth_sessions_mcp_server_id_idx" ON "mcp_oauth_sessions"("mcp_server_id");

-- CreateIndex
CREATE INDEX "mcp_server_tools_mcp_server_id_idx" ON "mcp_server_tools"("mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_tools_mcp_server_id_name_key" ON "mcp_server_tools"("mcp_server_id", "name");

-- CreateIndex
CREATE INDEX "agent_mcp_bindings_agent_id_idx" ON "agent_mcp_bindings"("agent_id");

-- CreateIndex
CREATE INDEX "agent_mcp_bindings_mcp_server_id_idx" ON "agent_mcp_bindings"("mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_mcp_bindings_agent_id_mcp_server_id_key" ON "agent_mcp_bindings"("agent_id", "mcp_server_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_subscriptions_org_id_key" ON "org_subscriptions"("org_id");

-- CreateIndex
CREATE INDEX "org_subscriptions_status_current_period_end_idx" ON "org_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "model_tiers_tier_key_key" ON "model_tiers"("tier_key");

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_oauth_sessions" ADD CONSTRAINT "mcp_oauth_sessions_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_tools" ADD CONSTRAINT "mcp_server_tools_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_bindings" ADD CONSTRAINT "agent_mcp_bindings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_mcp_bindings" ADD CONSTRAINT "agent_mcp_bindings_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
