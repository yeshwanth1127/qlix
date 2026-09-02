-- Rename the WhatsApp Outreach product plugin to Outreach.
UPDATE "org_plugins"
SET "plugin_id" = 'outreach'
WHERE "plugin_id" = 'whatsapp_outreach';
