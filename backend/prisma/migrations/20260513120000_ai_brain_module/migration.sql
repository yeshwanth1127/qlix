-- AI Brain module: org_brain agent kind + knowledge store + citations.

ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "agent_kind" TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE "brain_knowledge_collections" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "retention_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_knowledge_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brain_knowledge_documents" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "collection_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "source_uri" TEXT,
    "ingest_status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brain_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "document_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text_content" TEXT NOT NULL,
    "embedding_model" TEXT,

    CONSTRAINT "brain_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brain_knowledge_citations" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_message_id" TEXT,
    "collection_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_ordinal" INTEGER NOT NULL DEFAULT 0,
    "excerpt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_knowledge_citations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brain_knowledge_chunks_document_id_ordinal_key" ON "brain_knowledge_chunks"("document_id", "ordinal");

CREATE INDEX "brain_knowledge_collections_org_id_idx" ON "brain_knowledge_collections"("org_id");

CREATE INDEX "brain_knowledge_documents_org_id_idx" ON "brain_knowledge_documents"("org_id");

CREATE INDEX "brain_knowledge_documents_collection_id_idx" ON "brain_knowledge_documents"("collection_id");

CREATE INDEX "brain_knowledge_chunks_org_id_idx" ON "brain_knowledge_chunks"("org_id");

CREATE INDEX "brain_knowledge_citations_org_id_idx" ON "brain_knowledge_citations"("org_id");

CREATE INDEX "brain_knowledge_citations_agent_message_id_idx" ON "brain_knowledge_citations"("agent_message_id");

ALTER TABLE "brain_knowledge_collections" ADD CONSTRAINT "brain_knowledge_collections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brain_knowledge_documents" ADD CONSTRAINT "brain_knowledge_documents_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "brain_knowledge_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brain_knowledge_chunks" ADD CONSTRAINT "brain_knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "brain_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brain_knowledge_citations" ADD CONSTRAINT "brain_knowledge_citations_agent_message_id_fkey" FOREIGN KEY ("agent_message_id") REFERENCES "agent_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "brain_knowledge_citations" ADD CONSTRAINT "brain_knowledge_citations_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "brain_knowledge_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "brain_knowledge_citations" ADD CONSTRAINT "brain_knowledge_citations_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "brain_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
