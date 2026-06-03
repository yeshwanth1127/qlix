CREATE TABLE "verifiable_credentials" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "agent_did" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "issuer_did" TEXT NOT NULL,
  "subject_did" TEXT NOT NULL,
  "claims" JSONB NOT NULL,
  "signature" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "verifiable_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verifiable_credentials_agent_id_idx" ON "verifiable_credentials" ("agent_id");
CREATE INDEX "verifiable_credentials_agent_did_idx" ON "verifiable_credentials" ("agent_did");
CREATE INDEX "verifiable_credentials_type_idx" ON "verifiable_credentials" ("type");

ALTER TABLE "verifiable_credentials"
  ADD CONSTRAINT "verifiable_credentials_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
