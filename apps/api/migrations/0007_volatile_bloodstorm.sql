CREATE TABLE "external_agent_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"internal_agent_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_agent_mappings_scope_unique" UNIQUE("id","source_id","owner_id"),
	CONSTRAINT "external_agent_mappings_identity_unique" UNIQUE("owner_id","source_id","external_id"),
	CONSTRAINT "external_agent_mappings_values_check" CHECK (length("external_agent_mappings"."external_id") BETWEEN 1 AND 256 AND "external_agent_mappings"."status" IN ('ACTIVE','TOMBSTONED') AND "external_agent_mappings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "external_execution_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"agent_mapping_id" uuid NOT NULL,
	"collaboration_id" uuid,
	"delegation_id" uuid,
	"source_status" text,
	"status" text DEFAULT 'UNKNOWN' NOT NULL,
	"sequence_domain" text,
	"sequence" text,
	"last_event_id" text,
	"occurred_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_execution_mappings_identity_unique" UNIQUE("owner_id","source_id","external_id"),
	CONSTRAINT "external_execution_mappings_values_check" CHECK (length("external_execution_mappings"."external_id") BETWEEN 1 AND 256 AND "external_execution_mappings"."version" > 0 AND "external_execution_mappings"."status" IN ('UNKNOWN','QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') AND ("external_execution_mappings"."source_status" IS NULL OR length("external_execution_mappings"."source_status") BETWEEN 1 AND 256) AND ("external_execution_mappings"."sequence" IS NULL OR "external_execution_mappings"."sequence" ~ '^(0|[1-9][0-9]{0,39})$') AND (("external_execution_mappings"."sequence" IS NULL) = ("external_execution_mappings"."sequence_domain" IS NULL)) AND ("external_execution_mappings"."delegation_id" IS NULL OR "external_execution_mappings"."collaboration_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "external_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "external_event_inbox_identity_unique" UNIQUE("source_id","event_id","owner_id"),
	CONSTRAINT "external_event_inbox_scope_unique" UNIQUE("id","source_id","owner_id"),
	CONSTRAINT "external_event_inbox_values_check" CHECK (length("external_event_inbox"."event_id") BETWEEN 1 AND 256 AND "external_event_inbox"."content_hash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("external_event_inbox"."event") = 'object' AND octet_length("external_event_inbox"."event"::text) <= 16384 AND "external_event_inbox"."status" IN ('PENDING','APPLIED','STALE','OBSERVED','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT'))
);
--> statement-breakpoint
CREATE TABLE "external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"generation" integer NOT NULL,
	"adapter_type" text NOT NULL,
	"ordering_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_sources_scope_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "external_sources_identity_unique" UNIQUE("owner_id","connection_id","namespace","generation"),
	CONSTRAINT "external_sources_values_check" CHECK ("external_sources"."generation" BETWEEN 1 AND 1000000 AND "external_sources"."namespace" ~ '^[a-z][a-z0-9_.-]{0,63}$' AND "external_sources"."adapter_type" ~ '^[a-z][a-z0-9_.-]{0,63}$' AND ("external_sources"."ordering_domain" IS NULL OR "external_sources"."ordering_domain" ~ '^[a-z][a-z0-9_.-]{0,63}$'))
);
--> statement-breakpoint
ALTER TABLE "external_agent_mappings" ADD CONSTRAINT "external_agent_mappings_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_agent_mappings" ADD CONSTRAINT "external_agent_mappings_source_fk" FOREIGN KEY ("source_id","owner_id") REFERENCES "public"."external_sources"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_agent_mappings" ADD CONSTRAINT "external_agent_mappings_agent_fk" FOREIGN KEY ("internal_agent_id","owner_id") REFERENCES "public"."agents"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_execution_mappings" ADD CONSTRAINT "external_execution_mappings_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_execution_mappings" ADD CONSTRAINT "external_execution_mappings_agent_fk" FOREIGN KEY ("agent_mapping_id","source_id","owner_id") REFERENCES "public"."external_agent_mappings"("id","source_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_execution_mappings" ADD CONSTRAINT "external_execution_mappings_collaboration_fk" FOREIGN KEY ("collaboration_id","owner_id") REFERENCES "public"."collaboration_sessions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_execution_mappings" ADD CONSTRAINT "external_execution_mappings_delegation_fk" FOREIGN KEY ("delegation_id","collaboration_id","owner_id") REFERENCES "public"."collaboration_delegations"("id","session_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_execution_mappings" ADD CONSTRAINT "external_execution_mappings_event_fk" FOREIGN KEY ("source_id","last_event_id","owner_id") REFERENCES "public"."external_event_inbox"("source_id","event_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_event_inbox" ADD CONSTRAINT "external_event_inbox_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_event_inbox" ADD CONSTRAINT "external_event_inbox_source_fk" FOREIGN KEY ("source_id","owner_id") REFERENCES "public"."external_sources"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_connection_fk" FOREIGN KEY ("connection_id","owner_id") REFERENCES "public"."orchestrators"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "external_agent_mappings_active_agent_unique" ON "external_agent_mappings" USING btree ("owner_id","internal_agent_id") WHERE "external_agent_mappings"."status" = 'ACTIVE' AND "external_agent_mappings"."internal_agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "external_execution_mappings_agent_idx" ON "external_execution_mappings" USING btree ("owner_id","agent_mapping_id","id");--> statement-breakpoint
CREATE INDEX "external_execution_mappings_collaboration_idx" ON "external_execution_mappings" USING btree ("owner_id","collaboration_id","id");--> statement-breakpoint
CREATE INDEX "external_event_inbox_history_idx" ON "external_event_inbox" USING btree ("owner_id","source_id","id");--> statement-breakpoint
CREATE INDEX "external_event_inbox_pending_idx" ON "external_event_inbox" USING btree ("owner_id","source_id","id") WHERE "external_event_inbox"."status" IN ('PENDING','DEFERRED_MAPPING','DEFERRED_ORDERING','DEFERRED_CONFLICT');--> statement-breakpoint
-- Typed correlation guards: external rows can never target native authority.
CREATE FUNCTION elyqreth_external_mapping_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE src external_sources%ROWTYPE; member external_agent_mappings%ROWTYPE; a agents%ROWTYPE; ev external_event_inbox%ROWTYPE; c collaboration_sessions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text || ':external-ingestion',0));
 IF TG_TABLE_NAME='external_sources' THEN
  IF NOT EXISTS(SELECT 1 FROM orchestrators o WHERE o.id=NEW.connection_id AND o.owner_id=NEW.owner_id AND o.type=NEW.adapter_type AND o.type<>'native' AND o.registration_status='ENABLED') THEN RAISE EXCEPTION 'Invalid external source' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO src FROM external_sources WHERE id=NEW.source_id AND owner_id=NEW.owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid external scope' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='external_agent_mappings' THEN
  IF TG_OP='UPDATE' AND (OLD.status='TOMBSTONED' OR NEW.status<>'TOMBSTONED') THEN RAISE EXCEPTION 'Immutable external membership' USING ERRCODE='23514'; END IF;
  IF NEW.internal_agent_id IS NOT NULL THEN
   SELECT * INTO a FROM agents WHERE id=NEW.internal_agent_id AND owner_id=NEW.owner_id;
   IF NOT FOUND OR a.type<>'EXTERNAL' OR a.orchestrator_id<>src.connection_id THEN RAISE EXCEPTION 'Invalid external Agent mapping' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO member FROM external_agent_mappings WHERE id=NEW.agent_mapping_id AND source_id=NEW.source_id AND owner_id=NEW.owner_id;
 IF NOT FOUND OR member.status<>'ACTIVE' THEN RAISE EXCEPTION 'Inactive external identity' USING ERRCODE='23514'; END IF;
 IF member.internal_agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agents WHERE id=member.internal_agent_id AND owner_id=NEW.owner_id AND type='EXTERNAL' AND orchestrator_id=src.connection_id AND lifecycle_status<>'ARCHIVED') THEN RAISE EXCEPTION 'Invalid external identity' USING ERRCODE='23514'; END IF;
 IF NEW.collaboration_id IS NOT NULL THEN
  SELECT * INTO c FROM collaboration_sessions WHERE id=NEW.collaboration_id AND owner_id=NEW.owner_id;
  IF NOT FOUND OR c.authority<>'EXTERNAL' OR member.internal_agent_id IS NULL OR NOT EXISTS(SELECT 1 FROM collaboration_participants WHERE owner_id=NEW.owner_id AND session_id=NEW.collaboration_id AND agent_id=member.internal_agent_id AND left_at IS NULL) THEN RAISE EXCEPTION 'Invalid external collaboration' USING ERRCODE='23514'; END IF;
  IF NEW.delegation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM collaboration_delegations WHERE id=NEW.delegation_id AND session_id=NEW.collaboration_id AND owner_id=NEW.owner_id AND target_agent_id=member.internal_agent_id) THEN RAISE EXCEPTION 'Invalid external delegation' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'UNKNOWN' OR NEW.last_event_id IS NOT NULL OR NEW.sequence IS NOT NULL OR NEW.source_status IS NOT NULL THEN RAISE EXCEPTION 'Observation requires inbox evidence' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status IN ('COMPLETED','FAILED','CANCELLED') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'Terminal external outcome is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.sequence IS NOT NULL AND (NEW.sequence_domain IS DISTINCT FROM OLD.sequence_domain OR NEW.sequence IS NULL OR NEW.sequence::numeric<=OLD.sequence::numeric) THEN RAISE EXCEPTION 'Stale external observation' USING ERRCODE='23514'; END IF;
  SELECT * INTO ev FROM external_event_inbox WHERE source_id=NEW.source_id AND owner_id=NEW.owner_id AND event_id=NEW.last_event_id;
  IF NOT FOUND OR ev.status IN ('APPLIED','STALE','OBSERVED') OR ev.event->>'kind' IS DISTINCT FROM 'execution.observed' OR ev.event->>'externalExecutionId' IS DISTINCT FROM NEW.external_id OR ev.event->>'externalAgentId' IS DISTINCT FROM member.external_id OR src.ordering_domain IS NULL OR NEW.sequence_domain IS DISTINCT FROM src.ordering_domain OR NEW.sequence_domain IS DISTINCT FROM ev.event#>>'{sequence,domain}' OR NEW.sequence IS DISTINCT FROM ev.event#>>'{sequence,value}' OR NEW.source_status IS DISTINCT FROM ev.event->>'sourceStatus' OR NEW.status IS DISTINCT FROM (CASE WHEN ev.event->>'sourceStatus' IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED') THEN ev.event->>'sourceStatus' ELSE 'UNKNOWN' END) THEN RAISE EXCEPTION 'Invalid external observation evidence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE FUNCTION elyqreth_external_inbox_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.status<>'PENDING' OR NEW.processed_at IS NOT NULL THEN RAISE EXCEPTION 'Receipt must start pending' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status IN ('APPLIED','STALE','OBSERVED') THEN RAISE EXCEPTION 'Receipt is already processed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER external_sources_guard BEFORE INSERT ON external_sources FOR EACH ROW EXECUTE FUNCTION elyqreth_external_mapping_guard();
CREATE TRIGGER external_sources_history BEFORE UPDATE OR DELETE ON external_sources FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER external_agent_mappings_guard BEFORE INSERT OR UPDATE ON external_agent_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_external_mapping_guard();
CREATE TRIGGER external_agent_mappings_identity BEFORE UPDATE ON external_agent_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','source_id','external_id','internal_agent_id','created_at');
CREATE TRIGGER external_agent_mappings_metadata BEFORE UPDATE ON external_agent_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER external_agent_mappings_history BEFORE DELETE ON external_agent_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER external_execution_mappings_guard BEFORE INSERT OR UPDATE ON external_execution_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_external_mapping_guard();
CREATE TRIGGER external_execution_mappings_identity BEFORE UPDATE ON external_execution_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','source_id','external_id','agent_mapping_id','collaboration_id','delegation_id','created_at');
CREATE TRIGGER external_execution_mappings_metadata BEFORE UPDATE ON external_execution_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER external_execution_mappings_history BEFORE DELETE ON external_execution_mappings FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER external_event_inbox_guard BEFORE INSERT OR UPDATE ON external_event_inbox FOR EACH ROW EXECUTE FUNCTION elyqreth_external_inbox_guard();
CREATE TRIGGER external_event_inbox_identity BEFORE UPDATE ON external_event_inbox FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','source_id','event_id','content_hash','event','received_at','correlation_id');
CREATE TRIGGER external_event_inbox_history BEFORE DELETE ON external_event_inbox FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
