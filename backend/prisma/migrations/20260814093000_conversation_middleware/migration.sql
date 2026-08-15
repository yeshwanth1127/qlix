ALTER TABLE "wait_triggers"
ADD COLUMN "conversation_thread_id" TEXT;

CREATE TABLE "conversation_processes" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT,
    "external_ref_type" TEXT,
    "external_ref_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "completion_mode" TEXT NOT NULL DEFAULT 'all_terminal',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "conversation_processes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "process_id" TEXT,
    "parent_thread_id" TEXT,
    "workflow_version_id" TEXT,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "current_node_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "state_json" JSONB NOT NULL DEFAULT '{}',
    "result_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "channel" TEXT,
    "address" TEXT,
    "display_name" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_events" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "thread_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "direction" TEXT,
    "channel" TEXT,
    "idempotency_key" TEXT,
    "provider_event_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_bindings" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "thread_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "connector_id" TEXT,
    "key_type" TEXT NOT NULL,
    "key_value" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_outbox" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "thread_id" TEXT NOT NULL,
    "event_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversation_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_timers" (
    "id" TEXT NOT NULL,
    "org_id" UUID NOT NULL,
    "thread_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "idempotency_key" TEXT NOT NULL,
    "purpose" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "due_at" TIMESTAMP(3) NOT NULL,
    "fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_timers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_workflow_definitions" (
    "id" TEXT NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "latest_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversation_workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_workflow_versions" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "definition" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_workflow_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_processes_org_id_external_ref_type_external_ref_id_key" ON "conversation_processes"("org_id", "external_ref_type", "external_ref_id");
CREATE INDEX "conversation_processes_org_id_status_created_at_idx" ON "conversation_processes"("org_id", "status", "created_at");
CREATE INDEX "conversation_threads_org_id_status_created_at_idx" ON "conversation_threads"("org_id", "status", "created_at");
CREATE INDEX "conversation_threads_process_id_status_idx" ON "conversation_threads"("process_id", "status");
CREATE INDEX "conversation_threads_parent_thread_id_idx" ON "conversation_threads"("parent_thread_id");
CREATE INDEX "conversation_threads_workflow_version_id_idx" ON "conversation_threads"("workflow_version_id");
CREATE INDEX "conversation_participants_thread_id_idx" ON "conversation_participants"("thread_id");
CREATE INDEX "conversation_participants_channel_address_idx" ON "conversation_participants"("channel", "address");
CREATE UNIQUE INDEX "conversation_events_thread_id_seq_key" ON "conversation_events"("thread_id", "seq");
CREATE UNIQUE INDEX "conversation_events_thread_id_idempotency_key_key" ON "conversation_events"("thread_id", "idempotency_key");
CREATE INDEX "conversation_events_org_id_occurred_at_idx" ON "conversation_events"("org_id", "occurred_at");
CREATE INDEX "conversation_events_provider_event_id_idx" ON "conversation_events"("provider_event_id");
CREATE INDEX "conversation_bindings_org_id_channel_connector_id_key_type_key_value_active_idx" ON "conversation_bindings"("org_id", "channel", "connector_id", "key_type", "key_value", "active");
CREATE INDEX "conversation_bindings_thread_id_active_idx" ON "conversation_bindings"("thread_id", "active");
CREATE UNIQUE INDEX "conversation_outbox_idempotency_key_key" ON "conversation_outbox"("idempotency_key");
CREATE INDEX "conversation_outbox_status_available_at_idx" ON "conversation_outbox"("status", "available_at");
CREATE INDEX "conversation_outbox_thread_id_created_at_idx" ON "conversation_outbox"("thread_id", "created_at");
CREATE UNIQUE INDEX "conversation_timers_idempotency_key_key" ON "conversation_timers"("idempotency_key");
CREATE INDEX "conversation_timers_status_due_at_idx" ON "conversation_timers"("status", "due_at");
CREATE INDEX "conversation_timers_thread_id_status_idx" ON "conversation_timers"("thread_id", "status");
CREATE UNIQUE INDEX "conversation_workflow_definitions_org_id_key_key" ON "conversation_workflow_definitions"("org_id", "key");
CREATE INDEX "conversation_workflow_definitions_key_status_idx" ON "conversation_workflow_definitions"("key", "status");
CREATE UNIQUE INDEX "conversation_workflow_versions_definition_id_version_key" ON "conversation_workflow_versions"("definition_id", "version");
CREATE INDEX "conversation_workflow_versions_definition_id_status_idx" ON "conversation_workflow_versions"("definition_id", "status");
CREATE INDEX "wait_triggers_conversation_thread_id_idx" ON "wait_triggers"("conversation_thread_id");

