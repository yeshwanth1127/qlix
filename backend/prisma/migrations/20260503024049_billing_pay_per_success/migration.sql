-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "successful_event_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pricing_tiers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price" DECIMAL(18,8) NOT NULL,
    "included_successes" INTEGER NOT NULL DEFAULT 0,
    "overage_rate" DECIMAL(18,8) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_rates" (
    "id" UUID NOT NULL,
    "pricing_tier_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_rate_overrides" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_rate_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "successful_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_id" UUID,
    "event_type" TEXT NOT NULL,
    "amount_charged" DECIMAL(18,8) NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "successful_event_key" TEXT NOT NULL,
    "event_data" JSONB,
    "api_endpoint" TEXT,
    "http_status_code" INTEGER,
    "response_time_ms" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "successful_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failed_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent_id" UUID,
    "event_type" TEXT NOT NULL,
    "error_message" TEXT,
    "error_code" TEXT,
    "request_data" JSONB,
    "api_endpoint" TEXT,
    "http_status_code" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_metrics_daily" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "metric_date" DATE NOT NULL,
    "event_type" TEXT NOT NULL,
    "successful_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "revenue_generated" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_statements" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "billing_cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "finalized_at" TIMESTAMP(3),
    "subtotal" DECIMAL(18,8) NOT NULL,
    "total" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_statement_line_items" (
    "id" UUID NOT NULL,
    "billing_statement_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "amount" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_statement_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_tiers_name_key" ON "pricing_tiers"("name");

-- CreateIndex
CREATE INDEX "event_rates_event_type_idx" ON "event_rates"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "event_rates_pricing_tier_id_event_type_key" ON "event_rates"("pricing_tier_id", "event_type");

-- CreateIndex
CREATE INDEX "org_rate_overrides_org_id_event_type_effective_from_idx" ON "org_rate_overrides"("org_id", "event_type", "effective_from");

-- CreateIndex
CREATE INDEX "successful_events_org_id_occurred_at_idx" ON "successful_events"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "successful_events_org_id_billing_cycle_idx" ON "successful_events"("org_id", "billing_cycle");

-- CreateIndex
CREATE INDEX "successful_events_billing_cycle_idx" ON "successful_events"("billing_cycle");

-- CreateIndex
CREATE INDEX "successful_events_event_type_occurred_at_idx" ON "successful_events"("event_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "successful_events_org_id_successful_event_key_key" ON "successful_events"("org_id", "successful_event_key");

-- CreateIndex
CREATE INDEX "failed_events_org_id_occurred_at_idx" ON "failed_events"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "failed_events_org_id_created_at_idx" ON "failed_events"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_metrics_daily_org_id_metric_date_idx" ON "usage_metrics_daily"("org_id", "metric_date");

-- CreateIndex
CREATE UNIQUE INDEX "usage_metrics_daily_org_id_metric_date_event_type_key" ON "usage_metrics_daily"("org_id", "metric_date", "event_type");

-- CreateIndex
CREATE INDEX "billing_statements_billing_cycle_idx" ON "billing_statements"("billing_cycle");

-- CreateIndex
CREATE UNIQUE INDEX "billing_statements_org_id_billing_cycle_key" ON "billing_statements"("org_id", "billing_cycle");

-- CreateIndex
CREATE INDEX "billing_statement_line_items_billing_statement_id_idx" ON "billing_statement_line_items"("billing_statement_id");

-- CreateIndex
CREATE INDEX "billing_logs_org_id_created_at_idx" ON "billing_logs"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_successful_event_id_fkey" FOREIGN KEY ("successful_event_id") REFERENCES "successful_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rates" ADD CONSTRAINT "event_rates_pricing_tier_id_fkey" FOREIGN KEY ("pricing_tier_id") REFERENCES "pricing_tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_rate_overrides" ADD CONSTRAINT "org_rate_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "successful_events" ADD CONSTRAINT "successful_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "successful_events" ADD CONSTRAINT "successful_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "successful_events" ADD CONSTRAINT "successful_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failed_events" ADD CONSTRAINT "failed_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failed_events" ADD CONSTRAINT "failed_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failed_events" ADD CONSTRAINT "failed_events_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_metrics_daily" ADD CONSTRAINT "usage_metrics_daily_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_statements" ADD CONSTRAINT "billing_statements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_statement_line_items" ADD CONSTRAINT "billing_statement_line_items_billing_statement_id_fkey" FOREIGN KEY ("billing_statement_id") REFERENCES "billing_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_logs" ADD CONSTRAINT "billing_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
