CREATE TABLE "homepage_visits" (
    "id" UUID NOT NULL,
    "visitor_token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homepage_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "homepage_visits_visitor_token_hash_key"
    ON "homepage_visits"("visitor_token_hash");

CREATE INDEX "homepage_visits_created_at_idx"
    ON "homepage_visits"("created_at");
