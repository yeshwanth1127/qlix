-- Store per-contact instructions for WhatsApp auto-reply runs.
ALTER TABLE "whatsapp_auto_reply_sessions"
  ADD COLUMN IF NOT EXISTS "reply_instructions" TEXT;
