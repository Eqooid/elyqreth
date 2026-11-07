CREATE TABLE "collaboration_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"parent_task_id" uuid NOT NULL,
	"child_task_id" uuid,
	"continuation_task_id" uuid,
	"source_execution_id" uuid,
	"child_execution_id" uuid,
	"continuation_execution_id" uuid,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"actor_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "collaboration_delegations_scope_unique" UNIQUE("id","session_id","owner_id"),
	CONSTRAINT "collaboration_delegations_command_unique" UNIQUE("owner_id","actor_reference","idempotency_key"),
	CONSTRAINT "collaboration_delegations_status_check" CHECK ("collaboration_delegations"."status" IN ('REQUESTED','ACCEPTED','EXECUTING','AWAITING_RETURN','COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED')),
	CONSTRAINT "collaboration_delegations_identity_check" CHECK ("collaboration_delegations"."source_agent_id" <> "collaboration_delegations"."target_agent_id" AND ("collaboration_delegations"."child_task_id" IS NULL OR "collaboration_delegations"."child_task_id" <> "collaboration_delegations"."parent_task_id") AND ("collaboration_delegations"."continuation_task_id" IS NULL OR ("collaboration_delegations"."continuation_task_id" <> "collaboration_delegations"."parent_task_id" AND "collaboration_delegations"."continuation_task_id" <> "collaboration_delegations"."child_task_id"))),
	CONSTRAINT "collaboration_delegations_reference_check" CHECK (("collaboration_delegations"."child_execution_id" IS NULL OR "collaboration_delegations"."child_task_id" IS NOT NULL) AND ("collaboration_delegations"."continuation_execution_id" IS NULL OR "collaboration_delegations"."continuation_task_id" IS NOT NULL) AND ("collaboration_delegations"."continuation_task_id" IS NULL OR "collaboration_delegations"."child_task_id" IS NOT NULL) AND ("collaboration_delegations"."status" NOT IN ('ACCEPTED','EXECUTING','AWAITING_RETURN','COMPLETED') OR "collaboration_delegations"."child_task_id" IS NOT NULL)),
	CONSTRAINT "collaboration_delegations_command_check" CHECK ("collaboration_delegations"."actor_reference" ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND "collaboration_delegations"."idempotency_key" ~ '^[A-Za-z0-9._:-]{1,128}$' AND "collaboration_delegations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "collaboration_delegations_time_check" CHECK ("collaboration_delegations"."version" > 0 AND "collaboration_delegations"."updated_at" >= "collaboration_delegations"."created_at" AND ("collaboration_delegations"."finished_at" IS NULL OR "collaboration_delegations"."finished_at" >= "collaboration_delegations"."created_at") AND (("collaboration_delegations"."status" IN ('COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED')) = ("collaboration_delegations"."finished_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "collaboration_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'DELEGATE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "collaboration_participants_membership_unique" UNIQUE("session_id","agent_id","owner_id"),
	CONSTRAINT "collaboration_participants_role_check" CHECK ("collaboration_participants"."role" IN ('COORDINATOR','DELEGATE')),
	CONSTRAINT "collaboration_participants_time_check" CHECK ("collaboration_participants"."left_at" IS NULL OR "collaboration_participants"."left_at" >= "collaboration_participants"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "collaboration_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"authority" text DEFAULT 'NATIVE' NOT NULL,
	"root_task_id" uuid,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"actor_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "collaboration_sessions_scope_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "collaboration_sessions_command_unique" UNIQUE("owner_id","actor_reference","idempotency_key"),
	CONSTRAINT "collaboration_sessions_status_check" CHECK ("collaboration_sessions"."status" IN ('CREATED','ACTIVE','WAITING','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "collaboration_sessions_authority_check" CHECK ("collaboration_sessions"."authority" IN ('NATIVE','EXTERNAL')),
	CONSTRAINT "collaboration_sessions_command_check" CHECK ("collaboration_sessions"."actor_reference" ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND "collaboration_sessions"."idempotency_key" ~ '^[A-Za-z0-9._:-]{1,128}$' AND "collaboration_sessions"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "collaboration_sessions_time_check" CHECK ("collaboration_sessions"."version" > 0 AND "collaboration_sessions"."updated_at" >= "collaboration_sessions"."created_at" AND ("collaboration_sessions"."finished_at" IS NULL OR "collaboration_sessions"."finished_at" >= "collaboration_sessions"."created_at") AND (("collaboration_sessions"."status" IN ('COMPLETED','FAILED','CANCELLED')) = ("collaboration_sessions"."finished_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT "agent_events_aggregate_type_check";--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT "agent_events_aggregate_identity_check";--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "collaboration_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "delegation_id" uuid;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_session_fk" FOREIGN KEY ("session_id","owner_id") REFERENCES "public"."collaboration_sessions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_source_fk" FOREIGN KEY ("session_id","source_agent_id","owner_id") REFERENCES "public"."collaboration_participants"("session_id","agent_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_target_fk" FOREIGN KEY ("session_id","target_agent_id","owner_id") REFERENCES "public"."collaboration_participants"("session_id","agent_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_parentTaskId_fk" FOREIGN KEY ("parent_task_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_childTaskId_fk" FOREIGN KEY ("child_task_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_continuationTaskId_fk" FOREIGN KEY ("continuation_task_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_sourceExecutionId_fk" FOREIGN KEY ("source_execution_id","owner_id") REFERENCES "public"."executions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_childExecutionId_fk" FOREIGN KEY ("child_execution_id","owner_id") REFERENCES "public"."executions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_delegations" ADD CONSTRAINT "collaboration_delegations_continuationExecutionId_fk" FOREIGN KEY ("continuation_execution_id","owner_id") REFERENCES "public"."executions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_participants" ADD CONSTRAINT "collaboration_participants_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_participants" ADD CONSTRAINT "collaboration_participants_session_fk" FOREIGN KEY ("session_id","owner_id") REFERENCES "public"."collaboration_sessions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_participants" ADD CONSTRAINT "collaboration_participants_agent_fk" FOREIGN KEY ("agent_id","owner_id") REFERENCES "public"."agents"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_sessions" ADD CONSTRAINT "collaboration_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "collaboration_sessions" ADD CONSTRAINT "collaboration_sessions_root_fk" FOREIGN KEY ("root_task_id","owner_id") REFERENCES "public"."tasks"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "collaboration_delegations_child_unique" ON "collaboration_delegations" USING btree ("owner_id","child_task_id") WHERE "collaboration_delegations"."child_task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "collaboration_delegations_continuation_unique" ON "collaboration_delegations" USING btree ("owner_id","continuation_task_id") WHERE "collaboration_delegations"."continuation_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "collaboration_delegations_history_idx" ON "collaboration_delegations" USING btree ("owner_id","session_id","id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_source_idx" ON "collaboration_delegations" USING btree ("owner_id","source_agent_id","id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_target_idx" ON "collaboration_delegations" USING btree ("owner_id","target_agent_id","id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_parent_idx" ON "collaboration_delegations" USING btree ("owner_id","parent_task_id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_source_execution_idx" ON "collaboration_delegations" USING btree ("owner_id","source_execution_id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_child_execution_idx" ON "collaboration_delegations" USING btree ("owner_id","child_execution_id");--> statement-breakpoint
CREATE INDEX "collaboration_delegations_continuation_execution_idx" ON "collaboration_delegations" USING btree ("owner_id","continuation_execution_id");--> statement-breakpoint
CREATE INDEX "collaboration_participants_agent_idx" ON "collaboration_participants" USING btree ("owner_id","agent_id","session_id");--> statement-breakpoint
CREATE INDEX "collaboration_sessions_owner_status_idx" ON "collaboration_sessions" USING btree ("owner_id","status","id");--> statement-breakpoint
CREATE INDEX "collaboration_sessions_root_idx" ON "collaboration_sessions" USING btree ("owner_id","root_task_id");--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_collaboration_fk" FOREIGN KEY ("collaboration_id","owner_id") REFERENCES "public"."collaboration_sessions"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_delegation_fk" FOREIGN KEY ("delegation_id","collaboration_id","owner_id") REFERENCES "public"."collaboration_delegations"("id","session_id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "agent_events_collaboration_order_idx" ON "agent_events" USING btree ("owner_id","collaboration_id","stream_position");--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_aggregate_type_check" CHECK ("agent_events"."aggregate_type" IN ('agent','orchestrator','task','execution','collaboration','delegation'));--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_aggregate_identity_check" CHECK (("agent_events"."aggregate_type" = 'agent' AND "agent_events"."aggregate_id" = "agent_events"."agent_id" AND "agent_events"."agent_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'orchestrator' AND "agent_events"."aggregate_id" = "agent_events"."orchestrator_id" AND "agent_events"."orchestrator_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'task' AND "agent_events"."aggregate_id" = "agent_events"."task_id" AND "agent_events"."task_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'execution' AND "agent_events"."aggregate_id" = "agent_events"."execution_id" AND "agent_events"."execution_id" IS NOT NULL) OR ("agent_events"."aggregate_type" = 'collaboration' AND "agent_events"."aggregate_id" = "agent_events"."collaboration_id" AND "agent_events"."collaboration_id" IS NOT NULL AND "agent_events"."delegation_id" IS NULL) OR ("agent_events"."aggregate_type" = 'delegation' AND "agent_events"."aggregate_id" = "agent_events"."delegation_id" AND "agent_events"."delegation_id" IS NOT NULL AND "agent_events"."collaboration_id" IS NOT NULL));
--> statement-breakpoint
-- Serialize relationship writers before taking session/task locks. Never invokes runtime code.
CREATE FUNCTION elyqreth_collaboration_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE session_status text; edge_cycle boolean; current_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text || ':collaboration',0));
  IF TG_TABLE_NAME = 'collaboration_sessions' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status IN ('COMPLETED','FAILED','CANCELLED') THEN
        RAISE EXCEPTION 'Terminal collaboration is immutable' USING ERRCODE='23514';
      END IF;
      IF NEW.status <> OLD.status AND NOT (
        (OLD.status='CREATED' AND NEW.status IN ('ACTIVE','CANCELLED')) OR
        (OLD.status='ACTIVE' AND NEW.status IN ('WAITING','COMPLETED','FAILED','CANCELLED')) OR
        (OLD.status='WAITING' AND NEW.status IN ('ACTIVE','FAILED','CANCELLED'))) THEN
        RAISE EXCEPTION 'Invalid collaboration transition' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO session_status FROM collaboration_sessions WHERE id=NEW.session_id AND owner_id=NEW.owner_id FOR UPDATE;
  IF session_status IN ('COMPLETED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'Terminal collaboration is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME = 'collaboration_participants' THEN
    IF TG_OP='UPDATE' AND (OLD.left_at IS NOT NULL OR NEW.left_at IS NULL) THEN
      RAISE EXCEPTION 'Membership history is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status IN ('COMPLETED','FAILED','CANCELLED','REJECTED','EXPIRED') THEN
      RAISE EXCEPTION 'Terminal delegation is immutable' USING ERRCODE='23514';
    END IF;
    IF (OLD.child_task_id IS NOT NULL AND NEW.child_task_id IS DISTINCT FROM OLD.child_task_id) OR
       (OLD.continuation_task_id IS NOT NULL AND NEW.continuation_task_id IS DISTINCT FROM OLD.continuation_task_id) OR
       (OLD.child_execution_id IS NOT NULL AND NEW.child_execution_id IS DISTINCT FROM OLD.child_execution_id) OR
       (OLD.continuation_execution_id IS NOT NULL AND NEW.continuation_execution_id IS DISTINCT FROM OLD.continuation_execution_id) THEN
      RAISE EXCEPTION 'Correlation is write once' USING ERRCODE='23514';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status='REQUESTED' AND NEW.status IN ('ACCEPTED','REJECTED','CANCELLED','EXPIRED')) OR
      (OLD.status='ACCEPTED' AND NEW.status IN ('EXECUTING','CANCELLED','FAILED')) OR
      (OLD.status='EXECUTING' AND NEW.status IN ('AWAITING_RETURN','FAILED','CANCELLED')) OR
      (OLD.status='AWAITING_RETURN' AND NEW.status IN ('COMPLETED','FAILED','CANCELLED'))) THEN
      RAISE EXCEPTION 'Invalid delegation transition' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' OR NEW.child_task_id IS DISTINCT FROM OLD.child_task_id OR NEW.continuation_task_id IS DISTINCT FROM OLD.continuation_task_id THEN
    IF (SELECT count(*) FROM collaboration_participants WHERE session_id=NEW.session_id AND owner_id=NEW.owner_id AND agent_id IN (NEW.source_agent_id,NEW.target_agent_id) AND left_at IS NULL) <> 2 THEN
      RAISE EXCEPTION 'Active scoped participants required' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.parent_task_id AND owner_id=NEW.owner_id AND agent_id=NEW.source_agent_id) OR
    (NEW.child_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.child_task_id AND owner_id=NEW.owner_id AND agent_id=NEW.target_agent_id)) OR
    (NEW.continuation_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.continuation_task_id AND owner_id=NEW.owner_id AND agent_id=NEW.source_agent_id)) THEN
    RAISE EXCEPTION 'Task agent correlation mismatch' USING ERRCODE='23514';
  END IF;
  IF (NEW.source_execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM executions WHERE id=NEW.source_execution_id AND task_id=NEW.parent_task_id AND agent_id=NEW.source_agent_id AND owner_id=NEW.owner_id)) OR
    (NEW.child_execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM executions WHERE id=NEW.child_execution_id AND task_id=NEW.child_task_id AND agent_id=NEW.target_agent_id AND owner_id=NEW.owner_id)) OR
    (NEW.continuation_execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM executions WHERE id=NEW.continuation_execution_id AND task_id=NEW.continuation_task_id AND agent_id=NEW.source_agent_id AND owner_id=NEW.owner_id)) THEN
    RAISE EXCEPTION 'Execution task correlation mismatch' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM collaboration_delegations d WHERE d.owner_id=NEW.owner_id AND d.id<>NEW.id AND
     (NEW.child_task_id IN (d.child_task_id,d.continuation_task_id) OR NEW.continuation_task_id IN (d.child_task_id,d.continuation_task_id))) THEN
    RAISE EXCEPTION 'Work Task has another incoming relation' USING ERRCODE='23505';
  END IF;
  WITH RECURSIVE edges(a,b) AS (
    SELECT parent_task_id,child_task_id FROM collaboration_delegations WHERE owner_id=NEW.owner_id AND id<>NEW.id AND child_task_id IS NOT NULL
    UNION SELECT child_task_id,continuation_task_id FROM collaboration_delegations WHERE owner_id=NEW.owner_id AND id<>NEW.id AND continuation_task_id IS NOT NULL
    UNION SELECT NEW.parent_task_id,NEW.child_task_id WHERE NEW.child_task_id IS NOT NULL
    UNION SELECT NEW.child_task_id,NEW.continuation_task_id WHERE NEW.continuation_task_id IS NOT NULL
  ), paths(a,b) AS (SELECT a,b FROM edges UNION SELECT p.a,e.b FROM paths p JOIN edges e ON e.a=p.b)
  SELECT EXISTS(SELECT 1 FROM paths WHERE a=b) INTO edge_cycle;
  IF edge_cycle THEN RAISE EXCEPTION 'Cyclic Task relationship' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER collaboration_sessions_guard BEFORE INSERT OR UPDATE ON collaboration_sessions FOR EACH ROW EXECUTE FUNCTION elyqreth_collaboration_guard();
CREATE TRIGGER collaboration_sessions_identity BEFORE UPDATE ON collaboration_sessions FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','authority','root_task_id','actor_reference','idempotency_key','request_hash','created_at');
CREATE TRIGGER collaboration_sessions_metadata BEFORE UPDATE ON collaboration_sessions FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER collaboration_sessions_history BEFORE DELETE ON collaboration_sessions FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER collaboration_participants_guard BEFORE INSERT OR UPDATE ON collaboration_participants FOR EACH ROW EXECUTE FUNCTION elyqreth_collaboration_guard();
CREATE TRIGGER collaboration_participants_identity BEFORE UPDATE ON collaboration_participants FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','session_id','agent_id','role','joined_at');
CREATE TRIGGER collaboration_participants_history BEFORE DELETE ON collaboration_participants FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
CREATE TRIGGER collaboration_delegations_guard BEFORE INSERT OR UPDATE ON collaboration_delegations FOR EACH ROW EXECUTE FUNCTION elyqreth_collaboration_guard();
CREATE TRIGGER collaboration_delegations_identity BEFORE UPDATE ON collaboration_delegations FOR EACH ROW EXECUTE FUNCTION elyqreth_immutable_columns('id','owner_id','session_id','source_agent_id','target_agent_id','parent_task_id','source_execution_id','actor_reference','idempotency_key','request_hash','created_at');
CREATE TRIGGER collaboration_delegations_metadata BEFORE UPDATE ON collaboration_delegations FOR EACH ROW EXECUTE FUNCTION elyqreth_touch_record();
CREATE TRIGGER collaboration_delegations_history BEFORE DELETE ON collaboration_delegations FOR EACH ROW EXECUTE FUNCTION elyqreth_reject_history_mutation();
