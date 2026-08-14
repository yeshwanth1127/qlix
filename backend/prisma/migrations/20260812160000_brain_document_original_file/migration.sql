-- Retain original Brain upload bytes for WhatsApp / download (optional columns).
ALTER TABLE "brain_knowledge_documents" ADD COLUMN IF NOT EXISTS "original_file_name" TEXT;
ALTER TABLE "brain_knowledge_documents" ADD COLUMN IF NOT EXISTS "original_mime_type" TEXT;
ALTER TABLE "brain_knowledge_documents" ADD COLUMN IF NOT EXISTS "storage_key" TEXT;
