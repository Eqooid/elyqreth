CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"agent_id" uuid,
	"task_id" uuid,
	"execution_id" uuid,
	"orchestrator_id" uuid,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"aggregate_sequence" bigint NOT NULL,
	"stream_position" bigint DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'elyqreth' NOT NULL,
	"source_event_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_events_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "agent_events_owner_position_unique" UNIQUE("owner_id","stream_position"),
	CONSTRAINT "agent_events_aggregate_sequence_unique" UNIQUE("owner_id","aggregate_type","aggregate_id","aggregate_sequence"),
	CONSTRAINT "agent_events_schema_check" CHECK ("agent_events"."schema_version" > 0 AND "agent_events"."aggregate_version" > 0 AND "agent_events"."aggregate_sequence" > 0 AND "agent_events"."stream_position" > 0),
	CONSTRAINT "agent_events_type_check" CHECK ("agent_events"."event_type" ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_.]*$' AND length("agent_events"."event_type") <= 128),
	CONSTRAINT "agent_events_aggregate_type_check" CHECK ("agent_events"."aggregate_type" IN ('agent','orchestrator','task','execution')),
	CONSTRAINT "agent_events_aggregate_identity_check" CHECK (("agent_events"."aggregate_type" = 'agent' AND "agent_events"."aggregate_id" = "agent_events"."agent_id" AND "agent_events"."agent_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'orchestrator' AND "agent_events"."aggregate_id" = "agent_events"."orchestrator_id" AND "agent_events"."orchestrator_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'task' AND "agent_events"."aggregate_id" = "agent_events"."task_id" AND "agent_events"."task_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'execution' AND "agent_events"."aggregate_id" = "agent_events"."execution_id" AND "agent_events"."execution_id" IS NOT NULL)),
	CONSTRAINT "agent_events_reference_presence_check" CHECK (("agent_events"."task_id" IS NULL OR ("agent_events"."agent_id" IS NOT NULL AND "agent_events"."orchestrator_id" IS NOT NULL)) AND ("agent_events"."execution_id" IS NULL OR "agent_events"."task_id" IS NOT NULL)),
	CONSTRAINT "agent_events_payload_check" CHECK (jsonb_typeof("agent_events"."payload") = 'object' AND octet_length("agent_events"."payload"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"orchestrator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"lifecycle_status" text DEFAULT 'DISABLED' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "agents_name_check" CHECK (length(btrim("agents"."name")) BETWEEN 1 AND 160 AND "agents"."name" = btrim("agents"."name")),
	CONSTRAINT "agents_description_check" CHECK ("agents"."description" IS NULL OR length("agents"."description") <= 4000),
	CONSTRAINT "agents_type_check" CHECK ("agents"."type" IN ('RULE_BASED','LLM','EXTERNAL')),
	CONSTRAINT "agents_lifecycle_check" CHECK ("agents"."lifecycle_status" IN ('ACTIVE','DISABLED','ARCHIVED')),
	CONSTRAINT "agents_capabilities_check" CHECK (jsonb_typeof("agents"."capabilities") = 'array' AND octet_length("agents"."capabilities"::text) <= 16384),
	CONSTRAINT "agents_configuration_check" CHECK (jsonb_typeof("agents"."configuration") = 'object' AND octet_length("agents"."configuration"::text) <= 65536),
	CONSTRAINT "agents_configuration_secrets_check" CHECK (NOT ("agents"."configuration" ?| ARRAY['apiKey','api_key','password','secret','token','credentials'])),
	CONSTRAINT "agents_version_check" CHECK ("agents"."version" > 0),
	CONSTRAINT "agents_timestamps_check" CHECK ("agents"."updated_at" >= "agents"."created_at")
);
--> statement-breakpoint
CREATE TABLE "city_agent_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"city_id" text DEFAULT 'elyqreth' NOT NULL,
	"npc_id" text NOT NULL,
	"visualization_mode" text DEFAULT 'PASSIVE' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "city_agent_bindings_external_ids_check" CHECK (length(btrim("city_agent_bindings"."city_id")) BETWEEN 1 AND 128 AND length(btrim("city_agent_bindings"."npc_id")) BETWEEN 1 AND 255),
	CONSTRAINT "city_agent_bindings_mode_check" CHECK ("city_agent_bindings"."visualization_mode" IN ('PASSIVE','WORK_ACTIVITY')),
	CONSTRAINT "city_agent_bindings_timestamps_check" CHECK ("city_agent_bindings"."updated_at" >= "city_agent_bindings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "command_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_reference" text NOT NULL,
	"command_type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"correlation_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_audit_outcome_check" CHECK ("command_audit"."outcome" IN ('ACCEPTED','REJECTED','FAILED')),
	CONSTRAINT "command_audit_names_check" CHECK (length("command_audit"."actor_reference") BETWEEN 1 AND 160 AND length("command_audit"."command_type") BETWEEN 1 AND 128 AND length("command_audit"."resource_type") BETWEEN 1 AND 64),
	CONSTRAINT "command_audit_details_check" CHECK (jsonb_typeof("command_audit"."details") = 'object' AND octet_length("command_audit"."details"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_outbox_event_unique" UNIQUE("event_id"),
	CONSTRAINT "event_outbox_attempts_check" CHECK ("event_outbox"."attempts" >= 0 AND ("event_outbox"."published_at" IS NULL OR "event_outbox"."published_at" >= "event_outbox"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "execution_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_results_execution_unique" UNIQUE("execution_id"),
	CONSTRAINT "execution_results_size_check" CHECK (octet_length("execution_results"."body"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"orchestrator_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"authority" text DEFAULT 'NATIVE' NOT NULL,
	"submission_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"external_execution_id" text,
	"adapter_key" text,
	"config_version" integer,
	"agent_config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"result_reference" text,
	"result_availability" text DEFAULT 'NONE' NOT NULL,
	"deadline_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"reconciliation_state" text DEFAULT 'NONE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "executions_event_scope_unique" UNIQUE("id","task_id","agent_id","orchestrator_id","owner_id"),
	CONSTRAINT "executions_task_attempt_unique" UNIQUE("task_id","attempt_number"),
	CONSTRAINT "executions_submission_unique" UNIQUE("submission_key"),
	CONSTRAINT "executions_attempt_check" CHECK ("executions"."attempt_number" > 0),
	CONSTRAINT "executions_status_check" CHECK ("executions"."status" IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')),
	CONSTRAINT "executions_authority_check" CHECK ("executions"."authority" IN ('NATIVE','EXTERNAL')),
	CONSTRAINT "executions_result_availability_check" CHECK ("executions"."result_availability" IN ('NONE','PENDING','AVAILABLE','UNAVAILABLE')),
	CONSTRAINT "executions_terminal_timestamp_check" CHECK (("executions"."status" IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT')) = ("executions"."finished_at" IS NOT NULL)),
	CONSTRAINT "executions_start_check" CHECK (("executions"."status" NOT IN ('RUNNING','SUCCEEDED') OR "executions"."started_at" IS NOT NULL) AND ("executions"."status" <> 'PENDING' OR "executions"."started_at" IS NULL)),
	CONSTRAINT "executions_timestamps_check" CHECK ("executions"."updated_at" >= "executions"."created_at" AND ("executions"."started_at" IS NULL OR "executions"."started_at" >= "executions"."created_at") AND ("executions"."finished_at" IS NULL OR "executions"."finished_at" >= coalesce("executions"."started_at","executions"."created_at")) AND ("executions"."deadline_at" IS NULL OR "executions"."deadline_at" >= "executions"."created_at")),
	CONSTRAINT "executions_lease_check" CHECK (("executions"."lease_owner" IS NULL AND "executions"."lease_token" IS NULL AND "executions"."lease_expires_at" IS NULL) OR ("executions"."lease_owner" IS NOT NULL AND "executions"."lease_token" IS NOT NULL AND "executions"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "executions_error_check" CHECK (("executions"."error_code" IS NULL OR length("executions"."error_code") <= 128) AND ("executions"."error_message" IS NULL OR length("executions"."error_message") <= 2000) AND ("executions"."result_reference" IS NULL OR length("executions"."result_reference") BETWEEN 1 AND 512)),
	CONSTRAINT "executions_config_snapshot_check" CHECK (jsonb_typeof("executions"."agent_config_snapshot") = 'object' AND octet_length("executions"."agent_config_snapshot"::text) <= 65536),
	CONSTRAINT "executions_version_check" CHECK ("executions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "orchestrators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"registration_status" text DEFAULT 'DISABLED' NOT NULL,
	"connectivity_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrators_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "orchestrators_owner_name_unique" UNIQUE("owner_id","name"),
	CONSTRAINT "orchestrators_name_check" CHECK (length(btrim("orchestrators"."name")) BETWEEN 1 AND 160 AND "orchestrators"."name" = btrim("orchestrators"."name")),
	CONSTRAINT "orchestrators_type_check" CHECK ("orchestrators"."type" ~ '^[a-z][a-z0-9_.-]{0,63}$'),
	CONSTRAINT "orchestrators_registration_check" CHECK ("orchestrators"."registration_status" IN ('ENABLED','DISABLED')),
	CONSTRAINT "orchestrators_connectivity_check" CHECK ("orchestrators"."connectivity_status" IN ('UNKNOWN','CONNECTED','DEGRADED','DISCONNECTED','UNAVAILABLE')),
	CONSTRAINT "orchestrators_reference_check" CHECK ("orchestrators"."configuration_reference" IS NULL OR "orchestrators"."configuration_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'),
	CONSTRAINT "orchestrators_capabilities_check" CHECK (jsonb_typeof("orchestrators"."capabilities") = 'object' AND octet_length("orchestrators"."capabilities"::text) <= 65536),
	CONSTRAINT "orchestrators_version_check" CHECK ("orchestrators"."version" > 0),
	CONSTRAINT "orchestrators_timestamps_check" CHECK ("orchestrators"."updated_at" >= "orchestrators"."created_at")
);
--> statement-breakpoint
CREATE TABLE "owner_streams" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"last_position" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "owner_streams_position_check" CHECK ("owner_streams"."last_position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_name_check" CHECK (length(btrim("owners"."name")) BETWEEN 1 AND 160 AND "owners"."name" = btrim("owners"."name"))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"orchestrator_id" uuid NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"input" jsonb NOT NULL,
	"status_reason" text,
	"idempotency_key" text,
	"request_hash" text,
	"retry_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "tasks_route_scope_unique" UNIQUE("id","agent_id","orchestrator_id","owner_id"),
	CONSTRAINT "tasks_owner_idempotency_unique" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('CREATED','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "tasks_input_check" CHECK (octet_length("tasks"."input"::text) <= 65536),
	CONSTRAINT "tasks_retry_policy_check" CHECK (jsonb_typeof("tasks"."retry_policy") = 'object' AND octet_length("tasks"."retry_policy"::text) <= 65536),
	CONSTRAINT "tasks_idempotency_check" CHECK (("tasks"."idempotency_key" IS NULL AND "tasks"."request_hash" IS NULL) OR (length(btrim("tasks"."idempotency_key")) BETWEEN 1 AND 128 AND "tasks"."request_hash" ~ '^[a-f0-9]{64}$' AND "tasks"."idempotency_key" IS NOT NULL AND "tasks"."request_hash" IS NOT NULL)),
	CONSTRAINT "tasks_terminal_timestamp_check" CHECK (("tasks"."status" IN ('COMPLETED','FAILED','CANCELLED')) = ("tasks"."completed_at" IS NOT NULL)),
	CONSTRAINT "tasks_timestamps_check" CHECK ("tasks"."updated_at" >= "tasks"."created_at" AND ("tasks"."completed_at" IS NULL OR "tasks"."completed_at" >= "tasks"."created_at") AND ("tasks"."deadline_at" IS NULL OR "tasks"."deadline_at" >= "tasks"."created_at") AND ("tasks"."cancel_requested_at" IS NULL OR "tasks"."cancel_requested_at" >= "tasks"."created_at")),
	CONSTRAINT "tasks_version_check" CHECK ("tasks"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_scope_fk" FOREIGN KEY ("agent_id","owner_id") REFERENCES "public"."agents"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_orchestrator_scope_fk" FOREIGN KEY ("orchestrator_id","owner_id") REFERENCES "public"."orchestrators"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_task_scope_fk" FOREIGN KEY ("task_id","agent_id","orchestrator_id","owner_id") REFERENCES "public"."tasks"("id","agent_id","orchestrator_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_execution_scope_fk" FOREIGN KEY ("execution_id","task_id","agent_id","orchestrator_id","owner_id") REFERENCES "public"."executions"("id","task_id","agent_id","orchestrator_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_orchestrator_scope_fk" FOREIGN KEY ("orchestrator_id","owner_id") REFERENCES "public"."orchestrators"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "city_agent_bindings" ADD CONSTRAINT "city_agent_bindings_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "city_agent_bindings" ADD CONSTRAINT "city_agent_bindings_agent_scope_fk" FOREIGN KEY ("agent_id","owner_id") REFERENCES "public"."agents"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "command_audit" ADD CONSTRAINT "command_audit_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_event_scope_fk" FOREIGN KEY ("event_id","owner_id") REFERENCES "public"."agent_events"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_scope_fk" FOREIGN KEY ("execution_id","owner_id") REFERENCES "public"."executions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_task_route_scope_fk" FOREIGN KEY ("task_id","agent_id","orchestrator_id","owner_id") REFERENCES "public"."tasks"("id","agent_id","orchestrator_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "orchestrators" ADD CONSTRAINT "orchestrators_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "owner_streams" ADD CONSTRAINT "owner_streams_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_scope_fk" FOREIGN KEY ("agent_id","owner_id") REFERENCES "public"."agents"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_orchestrator_scope_fk" FOREIGN KEY ("orchestrator_id","owner_id") REFERENCES "public"."orchestrators"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_events_source_identity_idx" ON "agent_events" USING btree ("owner_id","source","source_event_id") WHERE "agent_events"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_events_task_order_idx" ON "agent_events" USING btree ("owner_id","task_id","stream_position");--> statement-breakpoint
CREATE INDEX "agent_events_correlation_order_idx" ON "agent_events" USING btree ("owner_id","correlation_id","stream_position");--> statement-breakpoint
CREATE INDEX "agent_events_execution_idx" ON "agent_events" USING btree ("owner_id","execution_id");--> statement-breakpoint
CREATE INDEX "agents_owner_orchestrator_idx" ON "agents" USING btree ("owner_id","orchestrator_id");--> statement-breakpoint
CREATE INDEX "agents_owner_lifecycle_idx" ON "agents" USING btree ("owner_id","lifecycle_status");--> statement-breakpoint
CREATE UNIQUE INDEX "city_agent_bindings_agent_active_idx" ON "city_agent_bindings" USING btree ("owner_id","city_id","agent_id") WHERE "city_agent_bindings"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "city_agent_bindings_npc_active_idx" ON "city_agent_bindings" USING btree ("owner_id","city_id","npc_id") WHERE "city_agent_bindings"."enabled";--> statement-breakpoint
CREATE INDEX "city_agent_bindings_npc_idx" ON "city_agent_bindings" USING btree ("owner_id","city_id","npc_id");--> statement-breakpoint
CREATE INDEX "command_audit_owner_created_idx" ON "command_audit" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "event_outbox_pending_idx" ON "event_outbox" USING btree ("next_attempt_at") WHERE "event_outbox"."published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "executions_one_active_per_task_idx" ON "executions" USING btree ("task_id") WHERE "executions"."status" IN ('PENDING','RUNNING');--> statement-breakpoint
CREATE UNIQUE INDEX "executions_one_success_per_task_idx" ON "executions" USING btree ("task_id") WHERE "executions"."status" = 'SUCCEEDED';--> statement-breakpoint
CREATE UNIQUE INDEX "executions_one_native_running_per_agent_idx" ON "executions" USING btree ("owner_id","agent_id") WHERE "executions"."authority" = 'NATIVE' AND "executions"."status" = 'RUNNING';--> statement-breakpoint
CREATE UNIQUE INDEX "executions_external_identity_idx" ON "executions" USING btree ("orchestrator_id","external_execution_id") WHERE "executions"."external_execution_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "executions_status_eligible_idx" ON "executions" USING btree ("status","next_eligible_at");--> statement-breakpoint
CREATE INDEX "executions_lease_expiry_idx" ON "executions" USING btree ("lease_expires_at") WHERE "executions"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "tasks_owner_status_created_idx" ON "tasks" USING btree ("owner_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_owner_agent_idx" ON "tasks" USING btree ("owner_id","agent_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_orchestrator_idx" ON "tasks" USING btree ("owner_id","orchestrator_id");