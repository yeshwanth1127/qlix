-- Add embedding_vec column to brain_knowledge_chunks for JSON-stored float vectors
ALTER TABLE "brain_knowledge_chunks" ADD COLUMN "embedding_vec" JSONB;
