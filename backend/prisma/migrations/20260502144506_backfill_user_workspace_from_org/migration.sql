-- Align users.workspace_kind with their organization (existing rows before column tracked choice).
UPDATE "users" AS u
SET "workspace_kind" = o."workspace_kind"
FROM "Organization" AS o
WHERE u."org_id" = o."id";
