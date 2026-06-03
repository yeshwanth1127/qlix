-- CreateTable
CREATE TABLE "billing_services" (
    "id" UUID NOT NULL,
    "service_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "unit_price" DECIMAL(18,8) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_services_service_key_key" ON "billing_services"("service_key");
